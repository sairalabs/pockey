import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createPockey,
  isPockeyError,
  memoryStorage,
  type PockeyClient,
  type TokenStorage,
} from '@pockey/core';
import {
  createTurnkeyKeyClient,
  memoryKeyStore,
  type KeyStore,
} from '@pockey/key-provider/client';
import { encryptOtpForTests } from '@pockey/key-provider/testing';
import { KeySession } from '@pockey/types';
import { base58, base64 } from '@scure/base';
import { verifyMessage, type Address, type Hex } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, EMBED_ORIGIN, env, otpFrom, SEED, seedDb } from './helpers.js';

/**
 * Contract test: @pockey/core against the real API inside Miniflare, with the
 * real Turnkey key client (session key in memory) and the Turnkey emulator
 * (KEY_PROVIDER=mock). Requests go through `app.request` with the embed Origin,
 * like the iframe.
 */

const BASE_URL = 'http://localhost:8787';
const key = (name: string) => `pockey:${SEED.app.publicId}:${name}`;

function keyClient(store: KeyStore) {
  return createTurnkeyKeyClient({
    store,
    enclave: { encryptOtp: (input) => encryptOtpForTests(input) },
  });
}

function sdk(storage: TokenStorage, store: KeyStore, calls: string[] = []): PockeyClient {
  return createPockey({
    appId: SEED.app.publicId,
    baseUrl: BASE_URL,
    storage,
    keys: keyClient(store),
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', EMBED_ORIGIN);
      const request = new Request(input, { ...init, headers });
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      return app.request(request, undefined, env);
    },
  });
}

async function emailLogin(pk: PockeyClient, email: string) {
  await pk.auth.loginWithEmail(email);
  return pk.auth.verifyOtp(otpFrom(email));
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (isPockeyError(e)) return e;
    throw e;
  }
  throw new Error('Expected a PockeyError');
}

beforeAll(async () => {
  await seedDb();
});

describe('@pockey/core against the API', () => {
  it('returns the seed public config', async () => {
    const config = await sdk(memoryStorage(), memoryKeyStore()).getConfig();
    expect(config.appId).toBe(SEED.app.publicId);
    expect(config.name).toBe(SEED.app.name);
    expect(config.loginMethods).toEqual(['email', 'google', 'apple', 'passkey', 'wallet']);
    expect(config.chains).toEqual({ evm: [8453, 84532], solana: ['devnet'] });
    expect(config.allowedOrigins).toEqual([...SEED.app.allowedOrigins]);
    expect(config.keyProvider.organizationId).toBeTruthy();
    expect(config.keyProvider.signerPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it('logs in by email OTP and gets a user with an EVM and a Solana wallet', async () => {
    const storage = memoryStorage();
    const store = memoryKeyStore();
    const calls: string[] = [];
    const pk = sdk(storage, store, calls);
    const response = await emailLogin(pk, 'sdk-login@test.dev');

    expect(calls).toEqual([
      'POST /v1/auth/email/start',
      'POST /v1/auth/email/verify',
      'POST /v1/auth/email/login',
    ]);
    expect(response.isNewUser).toBe(true);
    expect(response.user.wallets.map((w) => w.chainFamily).sort()).toEqual(['evm', 'solana']);
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(pk.auth.getUser()?.id).toBe(response.user.id);
    expect(await storage.get(key('refresh'))).toBe(response.refreshToken);
    expect(KeySession.parse(JSON.parse((await storage.get(key('keySession'))) ?? 'null'))).toEqual(
      response.keySession,
    );
    // The pending key became the session key, the device and cookie bridges are gone.
    const keys = await store.load();
    expect(keys.active).not.toBeNull();
    expect(keys.pending).toBeNull();
    expect(await storage.get(key('device'))).toBeNull();
    expect(await storage.get(key('authCookies'))).toBeNull();
    expect((await pk.wallets.list()).length).toBe(2);
  });

  it('logs in again with a new session key on the same user', async () => {
    const first = await emailLogin(sdk(memoryStorage(), memoryKeyStore()), 'sdk-again@test.dev');
    const second = await emailLogin(sdk(memoryStorage(), memoryKeyStore()), 'sdk-again@test.dev');
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.keySession.organizationId).toBe(first.keySession.organizationId);
  });

  it('signs with the EVM and Solana wallets through the helpers', async () => {
    const pk = sdk(memoryStorage(), memoryKeyStore());
    const { user } = await emailLogin(pk, 'sdk-sign@test.dev');
    const evm = user.wallets.find((w) => w.chainFamily === 'evm');
    const solana = user.wallets.find((w) => w.chainFamily === 'solana');
    if (!evm || !solana) throw new Error('missing wallets');

    const { signature } = await pk.wallets.evm.signMessage('gm');
    expect(
      await verifyMessage({
        address: evm.address as Address,
        message: 'gm',
        signature: signature as Hex,
      }),
    ).toBe(true);

    const message = base64.encode(new TextEncoder().encode('gm solana'));
    const solanaSig = await pk.wallets.solana.signMessage(message);
    expect(
      ed25519.verify(
        base64.decode(solanaSig.signature),
        base64.decode(message),
        base58.decode(solana.address),
      ),
    ).toBe(true);
  });

  it('restores the session in a second client sharing the storage and the key store', async () => {
    const storage = memoryStorage();
    const store = memoryKeyStore();
    const { user } = await emailLogin(sdk(storage, store), 'sdk-restore@test.dev');

    const second = sdk(storage, store);
    expect(second.auth.isAuthenticated()).toBe(false);
    const restored = await second.ready();
    expect(restored?.id).toBe(user.id);
    expect(second.auth.isAuthenticated()).toBe(true);
    const evm = user.wallets.find((w) => w.chainFamily === 'evm');
    const { signature } = await second.wallets.evm.signMessage('restored');
    expect(
      await verifyMessage({
        address: evm?.address as Address,
        message: 'restored',
        signature: signature as Hex,
      }),
    ).toBe(true);
  });

  it('drops stored tokens when the key store lost the session key', async () => {
    const storage = memoryStorage();
    await emailLogin(sdk(storage, memoryKeyStore()), 'sdk-lost-key@test.dev');

    const calls: string[] = [];
    const pk = sdk(storage, memoryKeyStore(), calls);
    expect(await pk.ready()).toBeNull();
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(calls).toEqual([]);
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('keySession'))).toBeNull();
  });

  it('refreshes an expired stored access token transparently', async () => {
    const storage = memoryStorage();
    const store = memoryKeyStore();
    const { user, refreshToken } = await emailLogin(sdk(storage, store), 'sdk-refresh@test.dev');
    await storage.set(key('accessExp'), new Date(Date.now() - 1000).toISOString());

    const calls: string[] = [];
    const pk = sdk(storage, store, calls);
    expect((await pk.ready())?.id).toBe(user.id);
    expect(calls).toEqual(['POST /v1/auth/refresh', 'GET /v1/me']);
    const rotated = await storage.get(key('refresh'));
    expect(rotated).not.toBe(refreshToken);
    expect(rotated).toMatch(/^pk_rt_/);
  });

  it('refreshes and retries once when the API refuses the access token', async () => {
    const storage = memoryStorage();
    const store = memoryKeyStore();
    await emailLogin(sdk(storage, store), 'sdk-retry@test.dev');
    // A well formed token the API cannot verify, with an expiry the client believes.
    await storage.set(key('access'), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged');

    const calls: string[] = [];
    const pk = sdk(storage, store, calls);
    await pk.ready();
    expect(calls).toEqual(['GET /v1/me', 'POST /v1/auth/refresh', 'GET /v1/me']);
    expect(pk.auth.getUser()).not.toBeNull();
  });

  it('creates a session signer, adding the Pockey signer only once', async () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const pk = sdk(storage, memoryKeyStore(), calls);
    const { user } = await emailLogin(pk, 'sdk-session@test.dev');
    const evm = user.wallets.find((w) => w.chainFamily === 'evm');
    if (!evm) throw new Error('missing wallet');

    const policy = { chain: 'evm' as const, expiresIn: '1h', maxValuePerTx: '1000' };
    const created = await pk.sessions.create({ walletId: evm.id, policy });
    expect(created.walletId).toBe(evm.id);
    expect(pk.sessions.isActive(created)).toBe(true);
    await pk.sessions.create({ walletId: evm.id, policy });

    expect(calls.filter((call) => call === 'POST /v1/sessions/signer')).toHaveLength(1);
    expect(calls.filter((call) => call === 'POST /v1/sessions')).toHaveLength(2);
    const stored = KeySession.parse(JSON.parse((await storage.get(key('keySession'))) ?? 'null'));
    expect(stored.signerUserId).toBeTruthy();
    expect((await pk.sessions.list()).length).toBe(2);
  });

  it('logs out: clears the key store, refreshUser resolves null and user calls throw not_authenticated', async () => {
    const storage = memoryStorage();
    const store = memoryKeyStore();
    const pk = sdk(storage, store);
    const { refreshToken } = await emailLogin(pk, 'sdk-logout@test.dev');
    const events: (string | null)[] = [];
    pk.auth.onChange((user) => events.push(user?.id ?? null));

    await pk.auth.logout();
    expect(events).toEqual([null]);
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('keySession'))).toBeNull();
    expect(await store.load()).toEqual({ active: null, pending: null });
    expect(await pk.auth.refreshUser()).toBeNull();
    expect((await errorOf(pk.wallets.list())).code).toBe('not_authenticated');
    expect((await errorOf(pk.wallets.evm.signMessage('gm'))).code).toBe('not_authenticated');

    // The server revoked the family: a client holding the old refresh token (and a
    // session key) loses its session.
    const stale = memoryStorage();
    await stale.set(key('refresh'), refreshToken);
    const staleStore = memoryKeyStore();
    const staleKeys = keyClient(staleStore);
    await staleKeys.pendingPublicKey();
    await staleKeys.activate();
    const revived = sdk(stale, staleStore);
    expect(await revived.ready()).toBeNull();
    expect(revived.auth.isAuthenticated()).toBe(false);
  });

  it('maps API errors', async () => {
    const pk = sdk(memoryStorage(), memoryKeyStore());
    const email = 'sdk-errors@test.dev';
    await pk.auth.sendEmailCode(email);
    const wrong = otpFrom(email) === '000000' ? '111111' : '000000';
    const error = await errorOf(pk.auth.verifyEmailCode(email, wrong));
    expect(error.status).toBeGreaterThanOrEqual(400);
    expect(error.requestId).toBeTruthy();
    expect(pk.auth.isAuthenticated()).toBe(false);
  });
});
