import { apps } from '@pockey/db';
import { ApiErrorBody, AuthTokens } from '@pockey/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueTokens } from '../src/auth/tokens.js';
import { parseEnv } from '../src/env.js';
import { bearer, db, env, loginWithEmail, postJson, request, SEED, seedDb } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

async function errorCode(res: Response): Promise<string> {
  return ApiErrorBody.parse(await res.json()).error.code;
}

describe('sessions', () => {
  it('issues a 15 minute access token and a 30 day refresh token', async () => {
    const { body } = await loginWithEmail('ttl@test.dev');
    const now = Date.now();
    const accessMs = Date.parse(body.accessTokenExpiresAt) - now;
    const refreshMs = Date.parse(body.refreshTokenExpiresAt) - now;
    expect(accessMs).toBeGreaterThan(14 * 60_000);
    expect(accessMs).toBeLessThanOrEqual(15 * 60_000);
    expect(refreshMs).toBeGreaterThan(29 * 86_400_000);
    expect(refreshMs).toBeLessThanOrEqual(30 * 86_400_000);
  });

  it('rotates the refresh token and revokes the family when an old one is replayed', async () => {
    const { body } = await loginWithEmail('rotate@test.dev');

    const first = await postJson('/v1/auth/refresh', { refreshToken: body.refreshToken });
    expect(first.status).toBe(200);
    const rotated = AuthTokens.parse(await first.json());
    expect(rotated.refreshToken).not.toBe(body.refreshToken);

    const meWithNew = await request('/v1/me', { headers: bearer(rotated.accessToken) });
    expect(meWithNew.status).toBe(200);

    // Replaying the first refresh token means it leaked: the whole session dies.
    const replay = await postJson('/v1/auth/refresh', { refreshToken: body.refreshToken });
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('session_expired');

    const afterReplay = await request('/v1/me', { headers: bearer(rotated.accessToken) });
    expect(afterReplay.status).toBe(401);
    const newRefresh = await postJson('/v1/auth/refresh', { refreshToken: rotated.refreshToken });
    expect(newRefresh.status).toBe(401);
  });

  it('logs out immediately, without waiting for the access token to expire', async () => {
    const { body } = await loginWithEmail('logout@test.dev');
    const logout = await request('/v1/auth/logout', {
      method: 'POST',
      headers: bearer(body.accessToken),
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ ok: true });

    expect((await request('/v1/me', { headers: bearer(body.accessToken) })).status).toBe(401);
    expect((await postJson('/v1/auth/refresh', { refreshToken: body.refreshToken })).status).toBe(
      401,
    );
  });

  it('keeps other sessions of the same user alive after a logout', async () => {
    const laptop = await loginWithEmail('two-devices@test.dev');
    const phone = await loginWithEmail('two-devices@test.dev');
    await request('/v1/auth/logout', { method: 'POST', headers: bearer(laptop.body.accessToken) });
    expect((await request('/v1/me', { headers: bearer(phone.body.accessToken) })).status).toBe(200);
  });

  it('rejects a tampered, a missing and an expired access token', async () => {
    const { body } = await loginWithEmail('tamper@test.dev');
    const [header, payload, signature] = body.accessToken.split('.');
    const forged = `${header}.${payload}.${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1)}`;
    expect((await request('/v1/me', { headers: bearer(forged) })).status).toBe(401);

    const missing = await request('/v1/me', {
      headers: { 'X-Pockey-App-Id': SEED.app.publicId },
    });
    expect(missing.status).toBe(401);
    expect(await errorCode(missing)).toBe('unauthorized');

    const app = await db().query.apps.findFirst({ where: eq(apps.id, SEED.app.id) });
    if (!app) throw new Error('seed app missing');
    const stale = await issueTokens({
      db: db(),
      config: parseEnv(env),
      app,
      endUserId: body.user.id,
      now: Date.now() - 16 * 60_000,
    });
    const expired = await request('/v1/me', { headers: bearer(stale.accessToken) });
    expect(expired.status).toBe(401);
    expect(await errorCode(expired)).toBe('session_expired');
  });

  it('validates the refresh body with the shared schema', async () => {
    const res = await postJson('/v1/auth/refresh', { refreshToken: 'nope' });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation_failed');
  });
});
