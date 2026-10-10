import { EvmAddress, type EndUser } from '@pockey/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPockey, type PockeyClient } from './client.js';
import { isPockeyError, PockeyError } from './errors.js';
import { memoryStorage, type TokenStorage } from './storage.js';
import {
  apiError,
  APP_ID,
  appConfig,
  authResponse,
  BASE_URL,
  endUser,
  EXPORTED_KEY,
  fakeApi,
  fakeKeys,
  json,
  keyError,
  keySession,
  PARENT_ORG,
  PENDING_PUBLIC_KEY,
  routeEmailLogin,
  stamped,
  tokens,
  wallet,
  type FakeApi,
  type FakeKeys,
} from './test-utils.js';

const RECIPIENT = EvmAddress.parse('0x2222222222222222222222222222222222222222');
const key = (name: string) => `pockey:${APP_ID}:${name}`;

let api: FakeApi;
let storage: TokenStorage;
let keys: FakeKeys;

function client(extra: { storage?: TokenStorage; keys?: FakeKeys | null } = {}): PockeyClient {
  const keyClient = extra.keys === null ? undefined : (extra.keys ?? keys).keys;
  return createPockey({
    appId: APP_ID,
    baseUrl: `${BASE_URL}/`,
    storage: extra.storage ?? storage,
    fetch: api.fetch,
    ...(keyClient ? { keys: keyClient } : {}),
  });
}

async function rejection(promise: Promise<unknown>): Promise<PockeyError> {
  try {
    await promise;
  } catch (e) {
    if (isPockeyError(e)) return e;
    throw e;
  }
  throw new Error('Expected a rejection');
}

async function signedIn(user: EndUser = endUser()): Promise<PockeyClient> {
  routeEmailLogin(api, { user });
  const pk = client();
  await pk.auth.loginWithEmail('a@test.dev');
  await pk.auth.verifyOtp('123456');
  return pk;
}

async function seedStorage(ttlMs: number, withKeySession = true) {
  const stored = tokens(ttlMs);
  await storage.set(key('refresh'), stored.refreshToken);
  await storage.set(key('access'), stored.accessToken);
  await storage.set(key('accessExp'), stored.accessTokenExpiresAt);
  if (withKeySession) await storage.set(key('keySession'), JSON.stringify(keySession()));
  return stored;
}

beforeEach(() => {
  api = fakeApi();
  storage = memoryStorage();
  keys = fakeKeys();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('construction', () => {
  it('rejects a malformed app id with bad_request', () => {
    let error: unknown;
    try {
      createPockey({ appId: 'app_nope', fetch: api.fetch });
    } catch (e) {
      error = e;
    }
    expect(isPockeyError(error) && error.code).toBe('bad_request');
  });

  it('tolerates a trailing slash and defaults the base url', () => {
    expect(client().baseUrl).toBe(BASE_URL);
    expect(createPockey({ appId: APP_ID, fetch: api.fetch }).baseUrl).toBe(
      'https://api.pockey.xyz',
    );
  });
});

describe('email login', () => {
  it('runs start, verify, login with the key client, then stores tokens and key session', async () => {
    const user = endUser();
    routeEmailLogin(api, { user });
    const pk = client();
    const seen: (EndUser | null)[] = [];
    pk.auth.onChange((u) => seen.push(u));

    await pk.auth.loginWithEmail('a@test.dev');
    const response = await pk.auth.verifyOtp(' 123456 ');

    expect(api.routes()).toEqual([
      'POST /v1/auth/email/start',
      'POST /v1/auth/email/verify',
      'POST /v1/auth/email/login',
    ]);
    expect(api.last('POST', '/v1/auth/email/start')?.body).toEqual({ email: 'a@test.dev' });
    expect(api.last('POST', '/v1/auth/email/verify')?.body).toEqual({
      otpId: 'otp_1',
      encryptedOtpBundle: 'encrypted:123456',
    });
    expect(api.last('POST', '/v1/auth/email/login')?.body).toEqual({
      mode: 'login',
      otpId: 'otp_1',
      publicKey: PENDING_PUBLIC_KEY,
      clientSignature: expect.objectContaining({ message: 'login:vtoken' }),
    });
    expect(keys.methods()).toEqual(['encryptOtp', 'loginProof', 'activate']);
    expect(keys.inputOf('encryptOtp')).toEqual({
      code: '123456',
      targetBundle: '{"target":"bundle"}',
    });
    expect(keys.inputOf('loginProof')).toEqual({ verificationToken: 'vtoken' });

    for (const call of api.calls) {
      expect(call.headers['x-pockey-app-id']).toBe(APP_ID);
      expect(call.headers['x-pockey-device']).toBeUndefined();
      expect(call.headers['x-pockey-auth-cookies']).toBeUndefined();
    }
    expect(await storage.get(key('refresh'))).toBe(response.refreshToken);
    expect(await storage.get(key('access'))).toBe(response.accessToken);
    expect(await storage.get(key('accessExp'))).toBe(response.accessTokenExpiresAt);
    expect(JSON.parse((await storage.get(key('keySession'))) ?? 'null')).toEqual(keySession());
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(pk.auth.getUser()).toEqual(user);
    expect(seen).toEqual([user]);
  });

  it('signs up with a session key proof bound to the normalized email', async () => {
    routeEmailLogin(api, { mode: 'signup' });
    const pk = client();
    await pk.auth.sendEmailCode(' A@Test.dev ');
    await pk.auth.verifyEmailCode('a@test.dev', '654321');

    expect(keys.methods()).toEqual(['encryptOtp', 'signupProof', 'activate']);
    expect(keys.inputOf('signupProof')).toEqual({
      verificationToken: 'vtoken',
      email: 'a@test.dev',
    });
    expect(api.last('POST', '/v1/auth/email/login')?.body).toEqual({
      mode: 'signup',
      otpId: 'otp_1',
      sessionKey: expect.objectContaining({ publicKey: PENDING_PUBLIC_KEY }),
      clientSignature: expect.objectContaining({ message: 'signup:vtoken' }),
    });
  });

  it('refuses verifyOtp without a prior loginWithEmail, without calling the API', async () => {
    const pk = client();
    const error = await rejection(pk.auth.verifyOtp('123456'));
    expect(error.code).toBe('bad_request');
    expect(api.calls).toHaveLength(0);
  });

  it('refuses a code for another email than the one started', async () => {
    routeEmailLogin(api);
    const pk = client();
    await pk.auth.sendEmailCode('a@test.dev');
    const error = await rejection(pk.auth.verifyEmailCode('b@test.dev', '123456'));
    expect(error.code).toBe('bad_request');
    expect(api.count('POST', '/v1/auth/email/verify')).toBe(0);
    expect(keys.methods()).toEqual([]);
  });

  it('throws unsupported without a key client, before calling the API', async () => {
    const pk = client({ keys: null });
    const error = await rejection(pk.auth.sendEmailCode('a@test.dev'));
    expect(error.code).toBe('unsupported');
    expect(api.calls).toHaveLength(0);
  });

  it('does not activate the key nor store anything when the login is refused', async () => {
    routeEmailLogin(api);
    api.on('POST', '/v1/auth/email/login', () => apiError('unauthorized', 401));
    const pk = client();
    await pk.auth.loginWithEmail('a@test.dev');
    const error = await rejection(pk.auth.verifyOtp('123456'));
    expect(error.code).toBe('unauthorized');
    expect(keys.methods()).not.toContain('activate');
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(await storage.get(key('refresh'))).toBeNull();
  });

  it('maps a key client failure on the proof and stops there', async () => {
    routeEmailLogin(api);
    keys.fail('loginProof', new Error('boom'));
    const pk = client();
    await pk.auth.loginWithEmail('a@test.dev');
    const error = await rejection(pk.auth.verifyOtp('123456'));
    expect(error.code).toBe('internal');
    expect(api.count('POST', '/v1/auth/email/login')).toBe(0);
  });
});

describe('wallet login', () => {
  it('uses the parent organization for a new EVM wallet and posts the stamped request', async () => {
    api.on('POST', '/v1/auth/wallet/lookup', () => json({ organizationId: null }));
    api.on('GET', `/v1/apps/${APP_ID}/config`, () => json(appConfig()));
    api.on('POST', '/v1/auth/wallet/login', () => json(authResponse()));
    const personalSign = vi.fn(async () => '0x01' as const);
    const pk = client();

    const response = await pk.auth.loginWithWallet({
      chainFamily: 'evm',
      address: '0x2222222222222222222222222222222222222222',
      personalSign,
    });

    expect(api.routes()).toEqual([
      'POST /v1/auth/wallet/lookup',
      `GET /v1/apps/${APP_ID}/config`,
      'POST /v1/auth/wallet/login',
    ]);
    expect(api.last('POST', '/v1/auth/wallet/lookup')?.body).toEqual({
      chainFamily: 'evm',
      address: '0x2222222222222222222222222222222222222222',
    });
    expect(keys.inputOf('loginRequest')).toEqual({
      organizationId: PARENT_ORG,
      credential: { kind: 'evm-wallet', personalSign },
    });
    expect(api.last('POST', '/v1/auth/wallet/login')?.body).toEqual({
      chainFamily: 'evm',
      request: stamped('stamp_login', { organizationId: PARENT_ORG }),
    });
    expect(keys.methods()).toEqual(['loginRequest', 'activate']);
    expect(pk.auth.getUser()?.id).toBe(response.user.id);
  });

  it('targets the existing sub-organization of a known Solana wallet', async () => {
    api.on('POST', '/v1/auth/wallet/lookup', () => json({ organizationId: 'org_known' }));
    api.on('POST', '/v1/auth/wallet/login', () => json(authResponse()));
    const signMessage = vi.fn(async () => new Uint8Array(64));
    const pk = client();

    await pk.auth.loginWithWallet({ chainFamily: 'solana', address: 'So1ana', signMessage });

    expect(api.count('GET', `/v1/apps/${APP_ID}/config`)).toBe(0);
    expect(keys.inputOf('loginRequest')).toEqual({
      organizationId: 'org_known',
      credential: { kind: 'solana-wallet', address: 'So1ana', signMessage },
    });
    expect(api.last('POST', '/v1/auth/wallet/login')?.body).toMatchObject({
      chainFamily: 'solana',
    });
  });
});

describe('restore on ready()', () => {
  it('restores a fresh stored session with a single /v1/me call', async () => {
    keys.state.active = true;
    const stored = await seedStorage(10 * 60_000);
    const user = endUser();
    api.on('GET', '/v1/me', () => json({ user, keySession: keySession() }));

    const pk = client();
    const [a, b] = await Promise.all([pk.ready(), pk.ready()]);
    expect(a).toEqual(user);
    expect(b).toEqual(user);
    expect(api.count('POST', '/v1/auth/refresh')).toBe(0);
    expect(api.count('GET', '/v1/me')).toBe(1);
    expect(api.last('GET', '/v1/me')?.headers.authorization).toBe(`Bearer ${stored.accessToken}`);
    expect(pk.auth.isAuthenticated()).toBe(true);
  });

  it('drops stored tokens when the key client has no session key', async () => {
    await seedStorage(10 * 60_000);
    const pk = client();
    expect(await pk.ready()).toBeNull();
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(api.calls).toHaveLength(0);
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('access'))).toBeNull();
    expect(await storage.get(key('keySession'))).toBeNull();
    expect(keys.methods(true)).toEqual(['hasSession', 'clear']);
  });

  it('refreshes an access token inside the leeway window before loading the user', async () => {
    keys.state.active = true;
    await seedStorage(30_000);
    const rotated = tokens();
    api.on('POST', '/v1/auth/refresh', () => json(rotated));
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: keySession() }));

    const pk = client();
    expect(await pk.ready()).not.toBeNull();
    expect(api.count('POST', '/v1/auth/refresh')).toBe(1);
    expect(api.last('GET', '/v1/me')?.headers.authorization).toBe(`Bearer ${rotated.accessToken}`);
    expect(await storage.get(key('refresh'))).toBe(rotated.refreshToken);
  });

  it('takes the key session from /v1/me when storage has none', async () => {
    keys.state.active = true;
    await seedStorage(10 * 60_000, false);
    const session = keySession({ signerUserId: 'tk_signer' });
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: session }));
    await client().ready();
    expect(JSON.parse((await storage.get(key('keySession'))) ?? 'null')).toEqual(session);
  });

  it('ignores garbage in storage', async () => {
    await storage.set(key('refresh'), 'not-a-token');
    await storage.set(key('keySession'), '{not json');
    const pk = client();
    expect(await pk.ready()).toBeNull();
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('treats an invalid stored access token as expired', async () => {
    keys.state.active = true;
    const stored = await seedStorage(10 * 60_000);
    await storage.set(key('access'), 'evil\r\nheader');
    api.on('POST', '/v1/auth/refresh', () => json(tokens()));
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: keySession() }));
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

  it('clears the session, the key session and emits null when the refresh is refused', async () => {
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
    expect(await storage.get(key('keySession'))).toBeNull();
    expect(keys.state.active).toBe(false);
    expect((await rejection(pk.wallets.list())).code).toBe('not_authenticated');
    expect(await pk.auth.refreshUser()).toBeNull();
  });

  it('keeps the session on a network error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const pk = await signedIn();
    const refreshToken = await storage.get(key('refresh'));
    const failing = api.fetch;
    let offline = true;
    const flaky = createPockey({
      appId: APP_ID,
      baseUrl: BASE_URL,
      storage,
      keys: keys.keys,
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
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: keySession() }));
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
    expect(error).toBeInstanceOf(PockeyError);
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
    const pk = createPockey({
      appId: APP_ID,
      storage,
      keys: keys.keys,
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    const error = await rejection(pk.auth.sendEmailCode('a@test.dev'));
    expect(error.code).toBe('network_error');
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe('wallets', () => {
  const evm = wallet('evm');
  const solana = wallet('solana');
  const organizationId = keySession().organizationId;

  it('evm.signMessage relays the request stamped for the user evm wallet', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${evm.id}/sign-message`, () => json({ signature: '0xabc' }));
    expect(await pk.wallets.evm.signMessage('gm')).toEqual({ signature: '0xabc' });
    const input = { chain: 'evm', message: 'gm' };
    expect(keys.inputOf('signMessage')).toEqual({
      organizationId,
      address: evm.address,
      message: input,
    });
    expect(api.last('POST', `/v1/wallets/${evm.id}/sign-message`)?.body).toEqual({
      input,
      request: stamped('sign_raw_payload', input),
    });
  });

  it('solana.signMessage and signTypedData stamp for the right wallet', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${solana.id}/sign-message`, () => json({ signature: 'c2ln' }));
    api.on('POST', `/v1/wallets/${evm.id}/sign-typed-data`, () => json({ signature: '0xdef' }));

    await pk.wallets.solana.signMessage('Z20=');
    expect(keys.inputOf('signMessage')).toEqual({
      organizationId,
      address: solana.address,
      message: { chain: 'solana', message: 'Z20=' },
    });

    const typed = {
      domain: { name: 'Test', chainId: 8453 },
      types: { Mail: [{ name: 'body', type: 'string' }] },
      primaryType: 'Mail',
      message: { body: 'gm' },
    };
    expect(await pk.wallets.evm.signTypedData(typed)).toEqual({ signature: '0xdef' });
    expect(keys.inputOf('signTypedData')).toEqual({
      organizationId,
      address: evm.address,
      typedData: { ...typed, chain: 'evm' },
    });
    expect(api.last('POST', `/v1/wallets/${evm.id}/sign-typed-data`)?.body).toEqual({
      input: { ...typed, chain: 'evm' },
      request: stamped('sign_raw_payload', { typed: evm.address }),
    });
  });

  it('prepares an EVM transaction, stamps what was prepared and sends the ticket', async () => {
    const pk = await signedIn();
    const prepared = { kind: 'transaction', ticket: 't'.repeat(24), unsignedTransaction: '0x02' };
    api.on('POST', `/v1/wallets/${evm.id}/prepare`, () => json(prepared));
    api.on('POST', `/v1/wallets/${evm.id}/send-transaction`, () =>
      json({ hash: '0xhash', sponsored: false }),
    );
    const tx = { chainId: 8453 as const, to: RECIPIENT, value: '1', data: '0x' };

    expect(await pk.wallets.evm.sendTransaction(tx)).toEqual({ hash: '0xhash', sponsored: false });
    const input = { ...tx, chain: 'evm', sponsored: false };
    expect(api.routes().slice(-2)).toEqual([
      `POST /v1/wallets/${evm.id}/prepare`,
      `POST /v1/wallets/${evm.id}/send-transaction`,
    ]);
    expect(api.last('POST', `/v1/wallets/${evm.id}/prepare`)?.body).toEqual({ input });
    expect(keys.inputOf('signTransaction')).toEqual({
      organizationId,
      address: evm.address,
      transaction: input,
      prepared,
    });
    expect(api.last('POST', `/v1/wallets/${evm.id}/send-transaction`)?.body).toEqual({
      input,
      request: stamped('sign_transaction', { kind: 'transaction' }),
      ticket: prepared.ticket,
    });
  });

  it('signs a Solana transaction without preparing it', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${solana.id}/sign-transaction`, () =>
      json({ signedTransaction: 'c2lnbmVk' }),
    );
    await pk.wallets.solana.signTransaction({ cluster: 'devnet', transaction: 'dHg=' });

    expect(api.count('POST', `/v1/wallets/${solana.id}/prepare`)).toBe(0);
    expect(keys.inputOf('signTransaction')?.prepared).toEqual({ kind: 'none' });
    expect(api.last('POST', `/v1/wallets/${solana.id}/sign-transaction`)?.body).toEqual({
      input: { chain: 'solana', cluster: 'devnet', transaction: 'dHg=' },
      request: stamped('sign_transaction', { kind: 'none' }),
    });
  });

  it('maps a prepared_mismatch from the key client to bad_request and sends nothing', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${evm.id}/prepare`, () =>
      json({ kind: 'transaction', ticket: 't'.repeat(24), unsignedTransaction: '0x02' }),
    );
    keys.fail('signTransaction', keyError('prepared_mismatch', 'recipient changed'));

    const error = await rejection(
      pk.wallets.evm.signTransaction({ chainId: 8453, to: RECIPIENT, value: '1', data: '0x' }),
    );
    expect(error.code).toBe('bad_request');
    expect(error.message).toBe('recipient changed');
    expect(error.details).toEqual({ reason: 'prepared_mismatch' });
    expect(api.count('POST', `/v1/wallets/${evm.id}/sign-transaction`)).toBe(0);
  });

  it('turns a key client without session key into not_authenticated key_session_missing', async () => {
    const pk = await signedIn();
    keys.state.active = false;
    const error = await rejection(pk.wallets.evm.signMessage('gm'));
    expect(error.code).toBe('not_authenticated');
    expect(error.details).toEqual({ reason: 'key_session_missing' });
    expect(api.count('POST', `/v1/wallets/${evm.id}/sign-message`)).toBe(0);
  });

  it('refuses to sign without a key session, before asking the key client', async () => {
    keys.state.active = true;
    await seedStorage(10 * 60_000, false);
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: null }));
    const pk = client();
    await pk.ready();
    expect(pk.auth.isAuthenticated()).toBe(true);

    const error = await rejection(pk.wallets.evm.signMessage('gm'));
    expect(error.code).toBe('not_authenticated');
    expect(error.details).toEqual({ reason: 'key_session_missing' });
    expect(keys.methods()).toEqual([]);
  });

  it('maps any other key client failure to internal', async () => {
    const pk = await signedIn();
    keys.fail('signMessage', new Error('iframe crashed'));
    const error = await rejection(pk.wallets.evm.signMessage('gm'));
    expect(error.code).toBe('internal');
    expect(error.message).toBe('iframe crashed');
  });

  it('exportWallet relays the stamped export and reveals the key locally', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/wallets/${evm.id}/export`, () => json({ encryptedBundle: 'bundle' }));

    expect(await pk.wallets.exportWallet(evm.id)).toEqual({ privateKey: EXPORTED_KEY });
    expect(keys.inputOf('exportAccount')).toEqual({
      organizationId,
      address: evm.address,
      chainFamily: 'evm',
    });
    expect(api.last('POST', `/v1/wallets/${evm.id}/export`)?.body).toEqual({
      request: stamped('export_wallet_account', { address: evm.address }),
    });
    expect(keys.exportBundles).toEqual(['bundle']);
  });

  it('refuses an unknown wallet id with not_found', async () => {
    const pk = await signedIn();
    api.on('GET', '/v1/me', () => json({ user: endUser(), keySession: keySession() }));
    const error = await rejection(
      pk.wallets.signMessage('wlt_unknown', { chain: 'evm', message: 'gm' }),
    );
    expect(error.code).toBe('not_found');
    expect(error.details).toEqual({ reason: 'wallet_not_found' });
    expect(keys.methods()).not.toContain('signMessage');
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
  it('logs out on the server, clears everything including the key client and emits null', async () => {
    const pk = await signedIn();
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
    expect(await storage.get(key('keySession'))).toBeNull();
    expect(keys.methods().at(-1)).toBe('clear');
    expect(keys.state.active).toBe(false);
  });

  it('clears local state even when the server call fails', async () => {
    const pk = await signedIn();
    api.on('POST', '/v1/auth/logout', () => apiError('internal', 500));
    await pk.auth.logout();
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(keys.state.active).toBe(false);
  });

  it('caches the public config per client', async () => {
    const config = appConfig();
    api.on('GET', `/v1/apps/${APP_ID}/config`, () => json(config));
    const pk = client();
    expect(await pk.getConfig()).toEqual(config);
    await pk.getConfig();
    expect(api.count('GET', `/v1/apps/${APP_ID}/config`)).toBe(1);
  });
});
