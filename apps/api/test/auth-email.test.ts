import { endUserIdentities } from '@pockey/db';
import {
  generateSessionKey,
  loginSignature,
  sessionKeyParams,
  signupSignature,
  type SessionKeyPair,
} from '@pockey/key-provider/client';
import { encryptOtpForTests } from '@pockey/key-provider/testing';
import { ApiErrorBody, AuthResponse, EmailOtpVerifyOutput, MeResponse } from '@pockey/types';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getEmulator } from '../src/lib/key-provider.js';
import { Device } from './device.js';
import {
  bearer,
  createTestApp,
  db,
  loginWithEmail,
  mailer,
  otpFrom,
  postJson,
  request,
  SEED,
  seedDb,
} from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

async function errorOf(res: Response) {
  return ApiErrorBody.parse(await res.json()).error;
}

/** Steps one and two by hand: start, then verify the code encrypted with `key`. */
async function verifyWith(email: string, key: SessionKeyPair) {
  const start = await Device.emailStart(email);
  const encryptedOtpBundle = await encryptOtpForTests({
    code: otpFrom(email),
    targetBundle: start.targetBundle,
    publicKey: key.publicKey,
  });
  const body = { otpId: start.otpId, encryptedOtpBundle };
  const res = await postJson('/v1/auth/email/verify', body);
  return { start, body, res };
}

async function signupBody(
  key: SessionKeyPair,
  otpId: string,
  verificationToken: string,
  email: string,
) {
  const sessionKey = sessionKeyParams(key.publicKey);
  return {
    mode: 'signup',
    otpId,
    sessionKey,
    clientSignature: await signupSignature({ key, verificationToken, email, sessionKey }),
  };
}

describe('email OTP login (T1.1, non-custodial)', () => {
  it('signs up in three steps: start, verify a ciphertext, signed login', async () => {
    const email = 'ada@test.dev';
    const key = await generateSessionKey();
    const { start, body, res } = await verifyWith(email, key);
    expect(start.otpId).toBeTruthy();
    expect(mailer().lastTo(email)?.text).toContain('expires in 10 minutes');

    // The code travels encrypted to the key provider enclave, never in clear.
    const code = otpFrom(email);
    expect(JSON.stringify(body)).not.toContain(code);
    expect(Object.keys(JSON.parse(body.encryptedOtpBundle) as object).sort()).toEqual([
      'ciphertext',
      'encappedPublic',
    ]);

    expect(res.status, await res.clone().text()).toBe(200);
    const { verificationToken, mode } = EmailOtpVerifyOutput.parse(await res.json());
    expect(mode).toBe('signup');

    const login = await postJson(
      '/v1/auth/email/login',
      await signupBody(key, start.otpId, verificationToken, email),
    );
    expect(login.status, await login.clone().text()).toBe(200);
    const auth = AuthResponse.parse(await login.json());
    expect(auth.isNewUser).toBe(true);
    expect(auth.accessToken.split('.')).toHaveLength(3);
    expect(auth.refreshToken.startsWith('pk_rt_')).toBe(true);
    expect(auth.user.identities).toEqual([
      expect.objectContaining({ type: 'email', identifier: email, verifiedAt: expect.any(String) }),
    ]);

    // The sub-organization has the email and the iframe key as its only root credentials.
    const org = getEmulator().inspect(auth.keySession.organizationId);
    expect(org.rootUser.id).toBe(auth.keySession.userId);
    expect(org.rootUser.email).toBe(email);
    expect(org.rootUser.apiKeys).toEqual([key.publicKey]);
    expect(org.users).toBe(1);

    const me = await request('/v1/me', { headers: bearer(auth.accessToken) });
    expect(me.status).toBe(200);
    expect(MeResponse.parse(await me.json()).user.id).toBe(auth.user.id);
  });

  it('refuses a wrong code, then accepts the right one', async () => {
    const email = 'typo@test.dev';
    const key = await generateSessionKey();
    const start = await Device.emailStart(email);
    const good = otpFrom(email);
    const bad = good === '000000' ? '111111' : '000000';
    const encrypt = (code: string) =>
      encryptOtpForTests({ code, targetBundle: start.targetBundle, publicKey: key.publicKey });

    const wrong = await postJson('/v1/auth/email/verify', {
      otpId: start.otpId,
      encryptedOtpBundle: await encrypt(bad),
    });
    expect(wrong.status).toBe(400);
    expect((await errorOf(wrong)).details).toMatchObject({ reason: 'invalid_code' });

    const right = await postJson('/v1/auth/email/verify', {
      otpId: start.otpId,
      encryptedOtpBundle: await encrypt(good),
    });
    expect(right.status, await right.clone().text()).toBe(200);
  });

  it('refuses the login step before the code is verified', async () => {
    const key = await generateSessionKey();
    const start = await Device.emailStart('early@test.dev');
    const early = await postJson('/v1/auth/email/login', {
      mode: 'login',
      otpId: start.otpId,
      publicKey: key.publicKey,
      clientSignature: {
        publicKey: key.publicKey,
        scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256',
        message: '{}',
        signature: '0'.repeat(128),
      },
    });
    expect(early.status).toBe(400);
  });

  it('invalidates the code after 5 wrong attempts', async () => {
    const email = 'brute@test.dev';
    const key = await generateSessionKey();
    const start = await Device.emailStart(email);
    const good = otpFrom(email);
    const bad = good === '000000' ? '111111' : '000000';
    const attempt = async (code: string) =>
      postJson('/v1/auth/email/verify', {
        otpId: start.otpId,
        encryptedOtpBundle: await encryptOtpForTests({
          code,
          targetBundle: start.targetBundle,
          publicKey: key.publicKey,
        }),
      });
    for (let i = 0; i < 5; i++) expect((await attempt(bad)).status).toBe(400);
    expect((await attempt(good)).status).toBe(400);
  });

  it('reuses the end user on a second login, in login mode, with a new session key', async () => {
    const email = 'grace@test.dev';
    const first = await Device.loginWithEmail(email);

    const key = await generateSessionKey();
    const { start, res } = await verifyWith(email, key);
    expect(res.status).toBe(200);
    const { verificationToken, mode } = EmailOtpVerifyOutput.parse(await res.json());
    expect(mode).toBe('login');

    // Signing up again is refused: the sub-organization exists.
    const again = await postJson(
      '/v1/auth/email/login',
      await signupBody(key, start.otpId, verificationToken, email),
    );
    expect(again.status).toBe(409);
    expect((await errorOf(again)).details).toMatchObject({ reason: 'account_exists' });

    const second = await Device.loginWithEmail(email);
    expect(second.auth.isNewUser).toBe(false);
    expect(second.auth.user.id).toBe(first.auth.user.id);
    expect(second.keySession.organizationId).toBe(first.keySession.organizationId);
    const org = getEmulator().inspect(first.keySession.organizationId);
    expect(org.rootUser.apiKeys).toEqual(
      expect.arrayContaining([first.key.publicKey, second.key.publicKey]),
    );
  });

  it('binds the verification token to the key that encrypted the code', async () => {
    const email = 'stolen@test.dev';
    const key = await generateSessionKey();
    const { start, res } = await verifyWith(email, key);
    const { verificationToken } = EmailOtpVerifyOutput.parse(await res.json());

    // Whoever reads the token (this API included) cannot register another key with it.
    const intruder = await generateSessionKey();
    const sessionKey = sessionKeyParams(intruder.publicKey);
    const hijack = await postJson('/v1/auth/email/login', {
      mode: 'signup',
      otpId: start.otpId,
      sessionKey,
      clientSignature: await signupSignature({
        key: intruder,
        verificationToken,
        email,
        sessionKey,
      }),
    });
    expect(hijack.status).toBe(401);
  });

  it('makes the otp id single use', async () => {
    const email = 'once@test.dev';
    const key = await generateSessionKey();
    const { start, res } = await verifyWith(email, key);
    const { verificationToken } = EmailOtpVerifyOutput.parse(await res.json());
    const body = await signupBody(key, start.otpId, verificationToken, email);
    expect((await postJson('/v1/auth/email/login', body)).status).toBe(200);

    const replay = await postJson('/v1/auth/email/login', {
      mode: 'login',
      otpId: start.otpId,
      publicKey: key.publicKey,
      clientSignature: await loginSignature({ key, verificationToken }),
    });
    expect(replay.status).toBe(400);
  });

  it('keeps apps isolated: same email, two apps, two end users', async () => {
    const other = await createTestApp({ loginMethods: ['email'] });
    const email = 'shared@test.dev';
    const inSeed = await loginWithEmail(email);
    const inOther = await loginWithEmail(email, { publicId: other.publicId });

    expect(inOther.body.isNewUser).toBe(true);
    expect(inOther.body.user.id).not.toBe(inSeed.body.user.id);
    expect(inOther.body.user.appId).toBe(other.id);
    expect(inOther.body.keySession.organizationId).not.toBe(inSeed.body.keySession.organizationId);
    const rows = await db()
      .select()
      .from(endUserIdentities)
      .where(and(eq(endUserIdentities.type, 'email'), eq(endUserIdentities.identifier, email)));
    expect(new Set(rows.map((row) => row.appId))).toEqual(new Set([SEED.app.id, other.id]));

    // A token from one app is refused by the other.
    const cross = await request('/v1/me', {
      headers: bearer(inSeed.body.accessToken, other.publicId),
    });
    expect(cross.status).toBe(401);

    // A code started in one app cannot be verified in another.
    const key = await generateSessionKey();
    const start = await Device.emailStart('cross-app@test.dev');
    const verify = await postJson(
      '/v1/auth/email/verify',
      {
        otpId: start.otpId,
        encryptedOtpBundle: await encryptOtpForTests({
          code: otpFrom('cross-app@test.dev'),
          targetBundle: start.targetBundle,
          publicKey: key.publicKey,
        }),
      },
      {},
      other.publicId,
    );
    expect(verify.status).toBe(400);
  });

  it('refuses a login method the app disabled', async () => {
    const walletOnly = await createTestApp({ loginMethods: ['wallet'] });
    const res = await postJson(
      '/v1/auth/email/start',
      { email: 'x@test.dev' },
      { Origin: 'https://other.example' },
      walletOnly.publicId,
    );
    expect(res.status).toBe(403);
    expect(mailer().lastTo('x@test.dev')).toBeUndefined();
  });

  it('no longer serves the Better Auth end user routes', async () => {
    for (const path of [
      '/v1/auth/email-otp/send-verification-otp',
      '/v1/auth/sign-in/email-otp',
      '/v1/auth/sign-up/email',
      '/v1/auth/session/exchange',
    ]) {
      const res = await postJson(path, {});
      expect(res.status, path).toBe(404);
    }
  });
});
