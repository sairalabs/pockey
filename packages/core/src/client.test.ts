import type { EndUser } from '@pocketkey/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPocketkey, type PocketkeyClient } from './client.js';
import { isPocketkeyError, PocketkeyError } from './errors.js';
import { memoryStorage, type TokenStorage } from './storage.js';
import {
  apiError,
  APP_ID,
  authResponse,
  BASE_URL,
  endUser,
  fakeApi,
  json,
  tokens,
  wallet,
  type FakeApi,
} from './test-utils.js';

const key = (name: string) => `pocketkey:${APP_ID}:${name}`;

let api: FakeApi;
let storage: TokenStorage;

function client(extra: { storage?: TokenStorage } = {}): PocketkeyClient {
  return createPocketkey({
    appId: APP_ID,
    baseUrl: `${BASE_URL}/`,
    storage: extra.storage ?? storage,
    fetch: api.fetch,
  });
}

async function rejection(promise: Promise<unknown>): Promise<PocketkeyError> {
  try {
    await promise;
  } catch (e) {
    if (isPocketkeyError(e)) return e;
    throw e;
  }
  throw new Error('Expected a rejection');
}

function routeEmailLogin(user: EndUser = endUser(), headers: Record<string, string> = {}) {
  api.on('POST', '/v1/auth/email-otp/send-verification-otp', () => json({ success: true }));
  api.on('POST', '/v1/auth/sign-in/email-otp', () => json(authResponse(user), 200, headers));
}

async function signedIn(user: EndUser = endUser()): Promise<PocketkeyClient> {
  routeEmailLogin(user);
  const pk = client();
  await pk.auth.loginWithEmail('a@test.dev');
  await pk.auth.verifyOtp('123456');
  return pk;
}

async function seedStorage(ttlMs: number) {
  const stored = tokens(ttlMs);
  await storage.set(key('refresh'), stored.refreshToken);
  await storage.set(key('access'), stored.accessToken);
  await storage.set(key('accessExp'), stored.accessTokenExpiresAt);
  return stored;
}

beforeEach(() => {
  api = fakeApi();
  storage = memoryStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('construction', () => {
  it('rejects a malformed app id with bad_request', () => {
    let error: unknown;
    try {
      createPocketkey({ appId: 'app_nope', fetch: api.fetch });
    } catch (e) {
      error = e;
    }
    expect(isPocketkeyError(error) && error.code).toBe('bad_request');
  });

  it('tolerates a trailing slash and defaults the base url', () => {
    expect(client().baseUrl).toBe(BASE_URL);
    expect(createPocketkey({ appId: APP_ID, fetch: api.fetch }).baseUrl).toBe(
      'https://api.pocketkey.dev',
    );
  });
});

describe('email login and storage', () => {
  it('stores namespaced tokens, sets the user and notifies listeners', async () => {
    const user = endUser();
    routeEmailLogin(user);
    const pk = client();
    const seen: (EndUser | null)[] = [];
    pk.auth.onChange((u) => seen.push(u));

    await pk.auth.loginWithEmail('a@test.dev');
    const response = await pk.auth.verifyOtp('123456');

    expect(api.last('POST', '/v1/auth/sign-in/email-otp')?.body).toEqual({
      email: 'a@test.dev',
      otp: '123456',
    });
    expect(
      api.last('POST', '/v1/auth/email-otp/send-verification-otp')?.headers['x-pocketkey-app-id'],
    ).toBe(APP_ID);
    expect(await storage.get(key('refresh'))).toBe(response.refreshToken);
    expect(await storage.get(key('access'))).toBe(response.accessToken);
    expect(await storage.get(key('accessExp'))).toBe(response.accessTokenExpiresAt);
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(pk.auth.getUser()).toEqual(user);
    expect(seen).toEqual([user]);
  });

  it('refuses verifyOtp without a prior loginWithEmail, without calling the API', async () => {
    const pk = client();
    const error = await rejection(pk.auth.verifyOtp('123456'));
    expect(error.code).toBe('bad_request');
    expect(api.calls).toHaveLength(0);
  });

  it('persists the device id and reuses it across calls and clients', async () => {
    routeEmailLogin();
    const pk = client();
    await pk.auth.loginWithEmail('a@test.dev');
    await pk.auth.verifyOtp('123456');

    const device = await storage.get(key('device'));
    expect(device).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    for (const call of api.calls) expect(call.headers['x-pocketkey-device']).toBe(device);

    await client().auth.sendEmailCode('b@test.dev');
    expect(
      api.last('POST', '/v1/auth/email-otp/send-verification-otp')?.headers['x-pocketkey-device'],
    ).toBe(device);
  });

  it('replaces a malformed stored device id', async () => {
    await storage.set(key('device'), 'bad id!');
    routeEmailLogin();
    await client().auth.sendEmailCode('a@test.dev');
    const device = await storage.get(key('device'));
    expect(device).not.toBe('bad id!');
    expect(api.calls[0]?.headers['x-pocketkey-device']).toBe(device);
  });
});

describe('restore on ready()', () => {
  it('restores a fresh stored session with a single /v1/me call', async () => {
    const stored = await seedStorage(10 * 60_000);
    const user = endUser();
    api.on('GET', '/v1/me', () => json({ user }));

    const pk = client();
    const [a, b] = await Promise.all([pk.ready(), pk.ready()]);
    expect(a).toEqual(user);
    expect(b).toEqual(user);
    expect(api.count('POST', '/v1/auth/refresh')).toBe(0);
    expect(api.count('GET', '/v1/me')).toBe(1);
    expect(api.last('GET', '/v1/me')?.headers.authorization).toBe(`Bearer ${stored.accessToken}`);
    expect(pk.auth.isAuthenticated()).toBe(true);
  });

  it('refreshes an access token inside the leeway window before loading the user', async () => {
    await seedStorage(30_000);
    const rotated = tokens();
    api.on('POST', '/v1/auth/refresh', () => json(rotated));
    api.on('GET', '/v1/me', () => json({ user: endUser() }));

    const pk = client();
    expect(await pk.ready()).not.toBeNull();
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
    expect(api.last('GET', '/v1/me')?.headers.authorization).toBe(`Bearer ${rotated.accessToken}`);
    expect(await storage.get(key('refresh'))).toBe(rotated.refreshToken);
  });

  it('ignores garbage in storage', async () => {
    await storage.set(key('refresh'), 'not-a-token');
    const pk = client();
    expect(await pk.ready()).toBeNull();
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('treats an invalid stored access token as expired', async () => {
    const stored = await seedStorage(10 * 60_000);
    await storage.set(key('access'), 'evil\r\nheader');
    api.on('POST', '/v1/auth/refresh', () => json(tokens()));
    api.on('GET', '/v1/me', () => json({ user: endUser() }));
    await client().ready();
    expect(api.last('POST', '/v1/auth/refresh')?.body).toEqual({
      refreshToken: stored.refreshToken,
    });
  });
});

describe('refresh', () => {
  it('shares one refresh between 5 concurrent calls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const pk = await signedIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on('POST', '/v1/auth/refresh', async () => {
      await gate;
      return json(tokens());
    });
    api.on('GET', '/v1/wallets', () => json({ wallets: [wallet('evm')] }));

    vi.setSystemTime(Date.now() + 15 * 60_000);
    const calls = Array.from({ length: 5 }, () => pk.wallets.list());
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const results = await Promise.all(calls);

    expect(results).toHaveLength(5);
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
    expect(api.count('GET', '/v1/wallets')).toBe(5);
  });

  it('refreshes once and retries once on a 401', async () => {
    const pk = await signedIn();
    const rotated = tokens();
    api.on('POST', '/v1/auth/refresh', () => json(rotated));
    let attempts = 0;
    api.on('GET', '/v1/wallets', () => {
      attempts += 1;
      return attempts === 1 ? apiError('session_expired', 401) : json({ wallets: [] });
    });

    expect(await pk.wallets.list()).toEqual([]);
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
    expect(api.last('GET', '/v1/wallets')?.headers.authorization).toBe(
      `Bearer ${rotated.accessToken}`,
    );
  });

  it('does not loop when the retried call is still refused', async () => {
    const pk = await signedIn();
    api.on('POST', '/v1/auth/refresh', () => json(tokens()));
    api.on('GET', '/v1/wallets', () => apiError('unauthorized', 401));

    const error = await rejection(pk.wallets.list());
    expect(error.code).toBe('unauthorized');
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
    expect(api.count('GET', '/v1/wallets')).toBe(2);
  });

  it('clears the session and emits null when the refresh is refused', async () => {
    const pk = await signedIn();
    const seen: (EndUser | null)[] = [];
    pk.auth.onChange((u) => seen.push(u));
    api.on('POST', '/v1/auth/refresh', () => apiError('session_expired', 401));
    api.on('GET', '/v1/wallets', () => apiError('session_expired', 401));

    const error = await rejection(pk.wallets.list());
    expect(error.code).toBe('not_authenticated');
    expect(error.status).toBe(401);
    expect(seen).toEqual([null]);
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(pk.auth.getUser()).toBeNull();
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('access'))).toBeNull();
    expect((await rejection(pk.wallets.list())).code).toBe('not_authenticated');
    expect(await pk.auth.refreshUser()).toBeNull();
  });

  it('keeps the session on a network error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const pk = await signedIn();
    const refreshToken = await storage.get(key('refresh'));
    const failing = api.fetch;
    let offline = true;
    const flaky = createPocketkey({
      appId: APP_ID,
      baseUrl: BASE_URL,
      storage,
      fetch: async (input, init) => {
        if (offline) throw new TypeError('Failed to fetch');
        return failing(input, init);
      },
    });
    await flaky.ready();
    expect(flaky.auth.isAuthenticated()).toBe(true);

    vi.setSystemTime(Date.now() + 15 * 60_000);
    const error = await rejection(flaky.wallets.list());
    expect(error.code).toBe('network_error');
    expect(flaky.auth.isAuthenticated()).toBe(true);
    expect(await storage.get(key('refresh'))).toBe(refreshToken);

    offline = false;
    api.on('POST', '/v1/auth/refresh', () => json(tokens()));
    api.on('GET', '/v1/wallets', () => json({ wallets: [] }));
    expect(await flaky.wallets.list()).toEqual([]);
    expect(pk.auth.isAuthenticated()).toBe(true);
  });

  it('adopts tokens another client on the same storage already rotated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const first = await signedIn();
    const second = client();
    api.on('GET', '/v1/me', () => json({ user: endUser() }));
    await second.ready();

    vi.setSystemTime(Date.now() + 15 * 60_000);
    api.on('POST', '/v1/auth/refresh', () => json(tokens()));
    api.on('GET', '/v1/wallets', () => json({ wallets: [] }));
    await first.wallets.list();
    await second.wallets.list();
    // The second client reuses the rotated tokens instead of replaying the old refresh token.
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
  });
});

describe('errors', () => {
  it('maps API error bodies', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${wallet('evm').id}/sign-message`, () =>
      apiError('policy_violation', 403, { rule: 'maxValuePerTx' }),
    );
    const error = await rejection(
      pk.wallets.signMessage(wallet('evm').id, { chain: 'evm', message: 'gm' }),
    );
    expect(error).toBeInstanceOf(PocketkeyError);
    expect(error.code).toBe('policy_violation');
    expect(error.status).toBe(403);
    expect(error.requestId).toBe('req_test');
    expect(error.details).toEqual({ rule: 'maxValuePerTx' });
  });

  it('maps non JSON error bodies by status', async () => {
    api.on(
      'GET',
      `/v1/apps/${APP_ID}/config`,
      () => new Response('<html>bad gateway</html>', { status: 502 }),
    );
    const error = await rejection(client().getConfig());
    expect(error.code).toBe('internal');
    expect(error.status).toBe(502);
  });

  it('throws invalid_response on a schema mismatch or invalid JSON', async () => {
    const pk = client();
    api.on('GET', `/v1/apps/${APP_ID}/config`, () => json({ appId: 'nope' }));
    const mismatch = await rejection(pk.getConfig());
    expect(mismatch.code).toBe('invalid_response');
    expect(Array.isArray(mismatch.details)).toBe(true);

    api.on('GET', `/v1/apps/${APP_ID}/config`, () => new Response('{oops', { status: 200 }));
    expect((await rejection(pk.getConfig())).code).toBe('invalid_response');
  });

  it('turns fetch rejections into network_error', async () => {
    const pk = createPocketkey({
      appId: APP_ID,
      storage,
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    const error = await rejection(pk.auth.sendEmailCode('a@test.dev'));
    expect(error.code).toBe('network_error');
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe('cookie bridge', () => {
  it('stores the header, sends it on auth routes only, and clears it on an empty value', async () => {
    routeEmailLogin(endUser(), { 'X-Pocketkey-Auth-Cookies': 'better-auth.session=abc' });
    const pk = client();
    await pk.auth.loginWithEmail('a@test.dev');
    await pk.auth.verifyOtp('123456');
    expect(await storage.get(key('authCookies'))).toBe('better-auth.session=abc');

    api.on('POST', '/v1/auth/wallet/nonce', () =>
      json({ nonce: 'a'.repeat(32), expiresAt: new Date(Date.now() + 60_000).toISOString() }, 200, {
        'X-Pocketkey-Auth-Cookies': '',
      }),
    );
    api.on('GET', '/v1/wallets', () => json({ wallets: [] }));
    await pk.wallets.list();
    expect(api.last('GET', '/v1/wallets')?.headers['x-pocketkey-auth-cookies']).toBeUndefined();

    await pk.auth.getWalletNonce('evm');
    expect(api.last('POST', '/v1/auth/wallet/nonce')?.headers['x-pocketkey-auth-cookies']).toBe(
      'better-auth.session=abc',
    );
    expect(await storage.get(key('authCookies'))).toBeNull();

    await pk.auth.getWalletNonce('evm');
    expect(
      api.last('POST', '/v1/auth/wallet/nonce')?.headers['x-pocketkey-auth-cookies'],
    ).toBeUndefined();
  });

  it('restores the stored bridge value on a new client', async () => {
    await storage.set(key('authCookies'), 'a=1');
    api.on('POST', '/v1/auth/wallet/nonce', () =>
      json({ nonce: 'a'.repeat(32), expiresAt: new Date().toISOString() }),
    );
    await client().auth.getWalletNonce('solana');
    expect(api.last('POST', '/v1/auth/wallet/nonce')?.headers['x-pocketkey-auth-cookies']).toBe(
      'a=1',
    );
  });
});

describe('wallets', () => {
  it('evm.signMessage signs with the user evm wallet', async () => {
    const pk = await signedIn();
    const evm = wallet('evm');
    api.on('POST', `/v1/wallets/${evm.id}/sign-message`, () => json({ signature: '0xabc' }));
    expect(await pk.wallets.evm.signMessage('gm')).toEqual({ signature: '0xabc' });
    expect(api.last('POST', `/v1/wallets/${evm.id}/sign-message`)?.body).toEqual({
      chain: 'evm',
      message: 'gm',
    });
  });

  it('evm.signMessage throws not_found without an evm wallet and not_authenticated when logged out', async () => {
    const pk = await signedIn(endUser([wallet('solana')]));
    const missing = await rejection(pk.wallets.evm.signMessage('gm'));
    expect(missing.code).toBe('not_found');
    expect(missing.details).toMatchObject({ reason: 'wallet_not_found' });

    const loggedOut = await rejection(
      client({ storage: memoryStorage() }).wallets.evm.signMessage('gm'),
    );
    expect(loggedOut.code).toBe('not_authenticated');
  });

  it('create adds the wallet to the cached user and get reads it', async () => {
    const pk = await signedIn(endUser([wallet('solana')]));
    expect(pk.wallets.get('evm')).toBeNull();
    api.on('POST', '/v1/wallets', () => json(wallet('evm'), 201));
    await pk.wallets.create('evm');
    expect(pk.wallets.get('evm')?.id).toBe(wallet('evm').id);
  });
});

describe('logout and config', () => {
  it('logs out on the server, clears everything and emits null', async () => {
    routeEmailLogin(endUser(), { 'X-Pocketkey-Auth-Cookies': 'a=1' });
    const pk = client();
    await pk.auth.loginWithEmail('a@test.dev');
    await pk.auth.verifyOtp('123456');
    const accessToken = await storage.get(key('access'));
    const seen: (EndUser | null)[] = [];
    pk.auth.onChange((u) => seen.push(u));
    api.on('POST', '/v1/auth/logout', () => json({ ok: true }));

    await pk.auth.logout();
    expect(api.last('POST', '/v1/auth/logout')?.headers.authorization).toBe(
      `Bearer ${accessToken ?? ''}`,
    );
    expect(seen).toEqual([null]);
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('authCookies'))).toBeNull();
    expect(await storage.get(key('device'))).not.toBeNull();
  });

  it('clears local state even when the server call fails', async () => {
    const pk = await signedIn();
    api.on('POST', '/v1/auth/logout', () => apiError('internal', 500));
    await pk.auth.logout();
    expect(pk.auth.isAuthenticated()).toBe(false);
  });

  it('caches the public config per client', async () => {
    const config = {
      appId: APP_ID,
      name: 'Test',
      loginMethods: ['email'],
      chains: { evm: [8453], solana: [] },
      appearance: { theme: 'system', accent: '#7c3aed' },
      embeddedWallets: { createOnLogin: 'all' },
      allowedOrigins: [],
    };
    api.on('GET', `/v1/apps/${APP_ID}/config`, () => json(config));
    const pk = client();
    expect(await pk.getConfig()).toEqual(config);
    await pk.getConfig();
    expect(api.count('GET', `/v1/apps/${APP_ID}/config`)).toBe(1);
  });
});
