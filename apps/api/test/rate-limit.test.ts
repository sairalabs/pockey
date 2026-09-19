import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env.js';
import { setRateLimiterForTests } from '../src/middleware/rate-limit.js';
import {
  createDurableRateLimiter,
  createMemoryRateLimiter,
  RATE_LIMIT_DEFAULTS,
  RateLimitDecision,
  type MemoryRateLimiter,
  type RateLimitScope,
} from '../src/rate-limit/index.js';
import {
  adminRequest,
  app as api,
  bearer,
  EMBED_ORIGIN,
  env,
  loginAsDeveloper,
  loginWithEmail,
  postJson,
  request,
  SEED,
  seedDb,
  withApp,
} from './helpers.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { scope: string; limit: number; resetAt: string };
  };
}

const limiter: MemoryRateLimiter = createMemoryRateLimiter();
const CONFIG_PATH = `/v1/apps/${SEED.app.publicId}/config`;

/** Burns a whole window on `scope:identifier` without going through the API. */
async function fill(scope: RateLimitScope, identifier: string): Promise<void> {
  const { limit, windowSeconds } = RATE_LIMIT_DEFAULTS[scope];
  const key = `${scope}:${identifier}`;
  for (let count = 0; count < limit; count++) {
    const decision = await limiter.consume({ key, limit, windowSeconds });
    expect(decision.allowed).toBe(true);
  }
}

const config = () => request(CONFIG_PATH, { headers: withApp({ Origin: EMBED_ORIGIN }) });

beforeAll(async () => {
  await seedDb();
});

beforeEach(() => {
  limiter.reset();
  setRateLimiterForTests(limiter);
});

afterAll(() => {
  setRateLimiterForTests(undefined);
});

describe('rate limiting (T5.5)', () => {
  it('caps an app at its window and recovers in the next one', async () => {
    await fill('app', SEED.app.publicId);

    const blocked = await config();
    expect(blocked.status).toBe(429);
    const body = await blocked.json<ErrorBody>();
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details?.scope).toBe('app');
    expect(body.error.details?.limit).toBe(RATE_LIMIT_DEFAULTS.app.limit);
    expect(Date.parse(body.error.details?.resetAt ?? '')).toBeGreaterThan(0);

    const retryAfter = Number(blocked.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMIT_DEFAULTS.app.windowSeconds);

    limiter.advance(RATE_LIMIT_DEFAULTS.app.windowSeconds * 1000);
    expect((await config()).status).toBe(200);
  });

  it('counts end users independently', async () => {
    const alice = (await loginWithEmail('rl-alice@test.dev')).body;
    const bob = (await loginWithEmail('rl-bob@test.dev')).body;
    await fill('user', alice.user.id);

    const blocked = await request('/v1/me', { headers: bearer(alice.accessToken) });
    expect(blocked.status).toBe(429);
    expect((await blocked.json<ErrorBody>()).error.details?.scope).toBe('user');

    expect((await request('/v1/me', { headers: bearer(bob.accessToken) })).status).toBe(200);
  });

  it('stops a brute force on one email without touching the others', async () => {
    const send = (email: string) => postJson('/v1/auth/email/start', { email });

    for (let attempt = 0; attempt < RATE_LIMIT_DEFAULTS.authIdentity.limit; attempt++) {
      expect((await send('rl-brute@test.dev')).status).toBe(200);
    }
    const blocked = await send('rl-brute@test.dev');
    expect(blocked.status).toBe(429);
    const body = await blocked.json<ErrorBody>();
    expect(body.error.details?.scope).toBe('authIdentity');
    expect(body.error.details?.limit).toBe(RATE_LIMIT_DEFAULTS.authIdentity.limit);

    // Another identity on the same app is untouched.
    expect((await send('rl-other@test.dev')).status).toBe(200);
  });

  it('caps every expensive auth route per app, and only those', async () => {
    await fill('authApp', SEED.app.publicId);
    const expensive = [
      '/v1/auth/email/start',
      '/v1/auth/email/verify',
      '/v1/auth/email/login',
      '/v1/auth/wallet/lookup',
      '/v1/auth/wallet/login',
      '/v1/auth/passkey/login',
      '/v1/auth/oauth/exchange',
    ];
    for (const path of expensive) {
      const res = await postJson(path, {});
      expect(res.status, path).toBe(429);
      expect((await res.json<ErrorBody>()).error.details?.scope, path).toBe('authApp');
    }

    // Refresh is cheap and must keep working while logins are throttled.
    const refresh = await postJson('/v1/auth/refresh', { refreshToken: 'nope' });
    expect(refresh.status).toBe(400);
  });

  it('caps a secret API key on /v1/server/*', async () => {
    await fill('serverKey', SEED.apiKey.id);
    const res = await request('/v1/server/users', {
      headers: {
        'X-Pocketkey-App-Id': SEED.app.publicId,
        Authorization: `Bearer ${SEED.apiKey.secret}`,
      },
    });
    expect(res.status).toBe(429);
    expect((await res.json<ErrorBody>()).error.details?.scope).toBe('serverKey');
  });

  it('caps sponsored sends per end user, before any balance is read', async () => {
    const { body: login, device } = await loginWithEmail('rl-sponsor@test.dev');
    const wallet = device.wallet('evm');
    await fill('sponsoredSend', login.user.id);

    // Sponsored EVM sends are counted when the user operation is prepared.
    const { res } = await device.prepare(wallet, {
      chain: 'evm',
      chainId: 84532,
      to: '0x4200000000000000000000000000000000000006',
      sponsored: true,
    });
    // Sponsoring is off on the seed app, so anything but 429 means the cap runs
    // after the business logic instead of before it.
    expect(res.status).toBe(429);
    expect((await res.json<ErrorBody>()).error.details?.scope).toBe('sponsoredSend');

    // The same wallet without sponsoring is not touched by that scope.
    const plain = await postJson(
      `/v1/wallets/${wallet.id}/sign-message`,
      await device.signMessageBody(wallet, { chain: 'evm', message: 'hello' }),
      device.headers(),
    );
    expect(plain.status, await plain.clone().text()).toBe(200);
  });

  it('never limits health or the dashboard', async () => {
    await fill('app', SEED.app.publicId);
    expect((await config()).status).toBe(429);

    expect((await request('/health')).status).toBe(200);

    const cookie = await loginAsDeveloper('rl-dev@test.dev');
    expect((await adminRequest('/admin/session', cookie)).status).toBe(200);
    expect((await adminRequest('/admin/billing', cookie)).status).toBe(200);
    expect((await adminRequest('/admin/apps', cookie)).status).toBe(200);
  });
});

describe('the RateLimiter durable object', () => {
  it('answers the documented shape and counts', async () => {
    const namespace = env.RATE_LIMITER;
    const stub = namespace.get(namespace.idFromName('probe'));
    const ask = () =>
      stub.fetch(
        new Request('https://rate-limiter.pocketkey.internal/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'probe', limit: 1, windowSeconds: 60 }),
        }),
      );

    const first = await ask();
    expect(first.status).toBe(200);
    const allowed = RateLimitDecision.parse(await first.json());
    expect(allowed).toMatchObject({ allowed: true, remaining: 0 });
    expect(allowed.resetAt).toBeGreaterThan(Date.now());

    const second = RateLimitDecision.parse(await (await ask()).json());
    expect(second.allowed).toBe(false);
  });

  it('enforces the binding end to end through the middleware', async () => {
    // Two per window, so the third call proves the Durable Object, the binding
    // and the `new_sqlite_classes` migration, not just the in-memory double.
    const tight: Env = { ...env, RATE_LIMITS: JSON.stringify({ app: 2 }) };
    setRateLimiterForTests(createDurableRateLimiter(env.RATE_LIMITER));

    const headers = withApp({ Origin: EMBED_ORIGIN });
    expect((await api.request(CONFIG_PATH, { headers }, tight)).status).toBe(200);
    expect((await api.request(CONFIG_PATH, { headers }, tight)).status).toBe(200);

    const blocked = await api.request(CONFIG_PATH, { headers }, tight);
    expect(blocked.status).toBe(429);
    const body = await blocked.json<ErrorBody>();
    expect(body.error.details).toMatchObject({ scope: 'app', limit: 2 });
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  });
});
