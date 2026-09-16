import { ApiErrorBody, MeResponse } from '@pocketkey/types';
import { baUser } from '@pocketkey/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  db,
  loginWithEmail,
  mailer,
  otpFrom,
  postJson,
  randomDevice,
  request,
  seedDb,
} from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

describe('email OTP login (T1.1)', () => {
  it('requires a device id to send a code', async () => {
    const res = await postJson('/v1/auth/email-otp/send-verification-otp', {
      email: 'a@test.dev',
      type: 'sign-in',
    });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('bad_request');
  });

  it('only allows the sign-in OTP type', async () => {
    const res = await postJson(
      '/v1/auth/email-otp/send-verification-otp',
      { email: 'a@test.dev', type: 'forget-password' },
      { 'X-Pocketkey-Device': randomDevice() },
    );
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('validation_failed');
  });

  it('sends a 6 digit code and signs in, returning tokens and the user', async () => {
    const { body, authCookies } = await loginWithEmail('ada@test.dev');
    expect(body.isNewUser).toBe(true);
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.refreshToken.startsWith('pk_rt_')).toBe(true);
    expect(body.user.identities).toEqual([
      expect.objectContaining({
        type: 'email',
        identifier: 'ada@test.dev',
        verifiedAt: expect.any(String),
      }),
    ]);
    // The Better Auth session travels in the bridge header, never as a third party cookie.
    expect(authCookies).toMatch(/session_token=/);

    const mail = mailer().lastTo('ada@test.dev');
    expect(mail?.text).toContain('expires in 10 minutes');

    const me = await request('/v1/me', { headers: bearer(body.accessToken) });
    expect(me.status).toBe(200);
    expect(MeResponse.parse(await me.json()).user.id).toBe(body.user.id);
  });

  it('returns the same end user on a second login', async () => {
    const first = await loginWithEmail('grace@test.dev');
    const second = await loginWithEmail('grace@test.dev');
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('binds the code to the device that requested it', async () => {
    const email = 'bound@test.dev';
    const deviceA = randomDevice();
    await postJson(
      '/v1/auth/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      { 'X-Pocketkey-Device': deviceA },
    );
    const res = await postJson(
      '/v1/auth/sign-in/email-otp',
      { email, otp: otpFrom(email) },
      { 'X-Pocketkey-Device': randomDevice() },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ApiErrorBody.safeParse(await res.json()).success).toBe(true);
  });

  it('invalidates the code after 5 wrong attempts', async () => {
    const email = 'brute@test.dev';
    const device = randomDevice();
    const headers = { 'X-Pocketkey-Device': device };
    await postJson('/v1/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }, headers);
    const good = otpFrom(email);
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const attempt = await postJson('/v1/auth/sign-in/email-otp', { email, otp: bad }, headers);
      expect(attempt.status).toBeGreaterThanOrEqual(400);
    }
    const late = await postJson('/v1/auth/sign-in/email-otp', { email, otp: good }, headers);
    expect(late.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps apps isolated: same email, two apps, two end users', async () => {
    const other = await createTestApp({ loginMethods: ['email'] });
    const email = 'shared@test.dev';
    const inSeed = await loginWithEmail(email);
    const inOther = await loginWithEmail(email, { publicId: other.publicId });

    expect(inOther.body.user.id).not.toBe(inSeed.body.user.id);
    expect(inOther.body.user.appId).toBe(other.id);
    const rows = await db().select().from(baUser).where(eq(baUser.email, email));
    expect(new Set(rows.map((row) => row.appId))).toEqual(
      new Set([inSeed.body.user.appId, other.id]),
    );

    // A token from one app is refused by the other.
    const cross = await request('/v1/me', {
      headers: bearer(inSeed.body.accessToken, other.publicId),
    });
    expect(cross.status).toBe(401);
  });

  it('refuses a login method the app disabled', async () => {
    const walletOnly = await createTestApp({ loginMethods: ['wallet'] });
    const res = await postJson(
      '/v1/auth/email-otp/send-verification-otp',
      { email: 'x@test.dev', type: 'sign-in' },
      { 'X-Pocketkey-Device': randomDevice(), Origin: 'https://other.example' },
      walletOnly.publicId,
    );
    expect(res.status).toBe(403);
  });

  it('keeps every other Better Auth endpoint closed', async () => {
    for (const path of ['/v1/auth/sign-up/email', '/v1/auth/update-user', '/v1/auth/delete-user']) {
      const res = await postJson(path, {});
      expect(res.status, path).toBe(404);
    }
  });
});
