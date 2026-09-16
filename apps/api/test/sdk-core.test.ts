import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createPocketkey,
  isPocketkeyError,
  memoryStorage,
  type PocketkeyClient,
  type TokenStorage,
} from '@pocketkey/core';
import { base58, base64 } from '@scure/base';
import { verifyMessage, type Address, type Hex } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, EMBED_ORIGIN, env, otpFrom, SEED, seedDb } from './helpers.js';

/**
 * Contract test: @pocketkey/core against the real API inside Miniflare.
 * Requests go through `app.request` with the embed Origin, like the iframe.
 */

const BASE_URL = 'http://localhost:8787';
const key = (name: string) => `pocketkey:${SEED.app.publicId}:${name}`;

function sdk(storage: TokenStorage, calls: string[] = []): PocketkeyClient {
  return createPocketkey({
    appId: SEED.app.publicId,
    baseUrl: BASE_URL,
    storage,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', EMBED_ORIGIN);
      const request = new Request(input, { ...init, headers });
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      return app.request(request, undefined, env);
    },
  });
}

async function emailLogin(pk: PocketkeyClient, email: string) {
  await pk.auth.loginWithEmail(email);
  return pk.auth.verifyOtp(otpFrom(email));
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (isPocketkeyError(e)) return e;
    throw e;
  }
  throw new Error('Expected a PocketkeyError');
}

beforeAll(async () => {
  await seedDb();
});

describe('@pocketkey/core against the API', () => {
  it('returns the seed public config', async () => {
    const config = await sdk(memoryStorage()).getConfig();
    expect(config.appId).toBe(SEED.app.publicId);
    expect(config.name).toBe(SEED.app.name);
    expect(config.loginMethods).toEqual(['email', 'google', 'apple', 'passkey', 'wallet']);
    expect(config.chains).toEqual({ evm: [8453, 84532], solana: ['devnet'] });
    expect(config.allowedOrigins).toEqual([...SEED.app.allowedOrigins]);
  });

  it('logs in by email OTP and gets a user with an EVM and a Solana wallet', async () => {
    const storage = memoryStorage();
    const pk = sdk(storage);
    const response = await emailLogin(pk, 'sdk-login@test.dev');

    expect(response.user.wallets.map((w) => w.chainFamily).sort()).toEqual(['evm', 'solana']);
    expect(pk.auth.isAuthenticated()).toBe(true);
    expect(pk.auth.getUser()?.id).toBe(response.user.id);
    expect(await storage.get(key('refresh'))).toBe(response.refreshToken);
    // The Better Auth session travels through the cookie bridge, ready for passkey enrollment.
    expect(await storage.get(key('authCookies'))).toBeTruthy();
    expect(await storage.get(key('device'))).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect((await pk.wallets.list()).length).toBe(2);
  });

  it('signs with the EVM and Solana wallets through the helpers', async () => {
    const pk = sdk(memoryStorage());
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

  it('restores the session in a second client sharing the storage', async () => {
    const storage = memoryStorage();
    const first = sdk(storage);
    const { user } = await emailLogin(first, 'sdk-restore@test.dev');

    const second = sdk(storage);
    expect(second.auth.isAuthenticated()).toBe(false);
    const restored = await second.ready();
    expect(restored?.id).toBe(user.id);
    expect(second.auth.isAuthenticated()).toBe(true);
    expect((await second.wallets.evm.signMessage('restored')).signature).toMatch(/^0x/);
  });

  it('refreshes an expired stored access token transparently', async () => {
    const storage = memoryStorage();
    const { user, refreshToken } = await emailLogin(sdk(storage), 'sdk-refresh@test.dev');
    await storage.set(key('accessExp'), new Date(Date.now() - 1000).toISOString());

    const calls: string[] = [];
    const pk = sdk(storage, calls);
    expect((await pk.ready())?.id).toBe(user.id);
    expect(calls).toEqual(['POST /v1/auth/refresh', 'GET /v1/me']);
    const rotated = await storage.get(key('refresh'));
    expect(rotated).not.toBe(refreshToken);
    expect(rotated).toMatch(/^pk_rt_/);
  });

  it('refreshes and retries once when the API refuses the access token', async () => {
    const storage = memoryStorage();
    await emailLogin(sdk(storage), 'sdk-retry@test.dev');
    // A well formed token the API cannot verify, with an expiry the client believes.
    await storage.set(key('access'), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged');

    const calls: string[] = [];
    const pk = sdk(storage, calls);
    await pk.ready();
    expect(calls).toEqual(['GET /v1/me', 'POST /v1/auth/refresh', 'GET /v1/me']);
    expect(pk.auth.getUser()).not.toBeNull();
  });

  it('logs out: refreshUser resolves null and user calls throw not_authenticated', async () => {
    const storage = memoryStorage();
    const pk = sdk(storage);
    const { refreshToken } = await emailLogin(pk, 'sdk-logout@test.dev');
    const events: (string | null)[] = [];
    pk.auth.onChange((user) => events.push(user?.id ?? null));

    await pk.auth.logout();
    expect(events).toEqual([null]);
    expect(pk.auth.isAuthenticated()).toBe(false);
    expect(await storage.get(key('refresh'))).toBeNull();
    expect(await storage.get(key('authCookies'))).toBeNull();
    expect(await pk.auth.refreshUser()).toBeNull();
    expect((await errorOf(pk.wallets.list())).code).toBe('not_authenticated');
    expect((await errorOf(pk.wallets.evm.signMessage('gm'))).code).toBe('not_authenticated');

    // The server revoked the family: a client holding the old refresh token loses its session.
    const stale = memoryStorage();
    await stale.set(key('refresh'), refreshToken);
    const revived = sdk(stale);
    expect(await revived.ready()).toBeNull();
    expect(revived.auth.isAuthenticated()).toBe(false);
  });

  it('maps API errors', async () => {
    const pk = sdk(memoryStorage());
    const error = await errorOf(pk.auth.verifyEmailCode('sdk-errors@test.dev', '000000'));
    expect(error.status).toBeGreaterThanOrEqual(400);
    expect(error.requestId).toBeTruthy();
  });
});
