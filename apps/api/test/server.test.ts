import type { EvmRpc } from '@pockey/chains-evm';
import type { SolanaRpc } from '@pockey/chains-solana';
import {
  apiKeyPrefix,
  apiKeys,
  endUsers,
  newId,
  newSecretApiKey,
  sha256Hex,
  usageEvents,
} from '@pockey/db';
import {
  ApiErrorBody,
  ServerUserList,
  SessionSignOutput,
  type AuthResponse,
} from '@pockey/types';
import { base58 } from '@scure/base';
import { and, eq } from 'drizzle-orm';
import { recoverTransactionAddress, verifyMessage, type Address, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setRpcFactory } from '../src/lib/rpc.js';
import type { Device } from './device.js';
import {
  bearer,
  createTestApp,
  db,
  EMBED_ORIGIN,
  loginWithEmail,
  request,
  SEED,
  seedDb,
} from './helpers.js';

const fakeEvm: EvmRpc = {
  getTransactionCount: async () => 0,
  estimateGas: async () => 21_000n,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
  sendRawTransaction: async () => '0x01',
};
const fakeSolana: SolanaRpc = {
  getLatestBlockhash: async () => ({
    blockhash: base58.encode(new Uint8Array(32)),
    lastValidBlockHeight: 1,
  }),
  sendRawTransaction: async () => 'ignored',
};

const secretHeaders = (
  secret: string = SEED.apiKey.secret,
  publicId: string = SEED.app.publicId,
): Record<string, string> => ({
  'X-Pockey-App-Id': publicId,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
});

const server = (path: string, init: RequestInit = {}, headers = secretHeaders()) =>
  request(`/v1/server${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(status);
  expect(ApiErrorBody.parse(await res.json()).error.code).toBe(code);
}

let alice: AuthResponse;
let aliceDevice: Device;

beforeAll(async () => {
  await seedDb();
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  ({ body: alice, device: aliceDevice } = await loginWithEmail('alice@server.test'));
});

afterAll(() => {
  setRpcFactory(undefined);
});

describe('requireApiKey', () => {
  it('refuses missing, malformed and unknown keys', async () => {
    const { Authorization: _drop, ...noKey } = secretHeaders();
    await expectError(await server('/users', {}, noKey), 401, 'api_key_invalid');
    await expectError(
      await server('/users', {}, secretHeaders('pk_sk_short')),
      401,
      'api_key_invalid',
    );
    await expectError(
      await server('/users', {}, secretHeaders(newSecretApiKey())),
      401,
      'api_key_invalid',
    );
  });

  it('refuses a key of another app and a revoked key', async () => {
    const other = await createTestApp();
    const otherSecret = newSecretApiKey();
    await db()
      .insert(apiKeys)
      .values({
        id: newId('key'),
        appId: other.id,
        hash: await sha256Hex(otherSecret),
        prefix: apiKeyPrefix(otherSecret),
      });
    await expectError(
      await server('/users', {}, secretHeaders(otherSecret)),
      401,
      'api_key_invalid',
    );
    await expectError(
      await server('/users', {}, secretHeaders(SEED.apiKey.secret, other.publicId)),
      401,
      'api_key_invalid',
    );
    expect((await server('/users', {}, secretHeaders(otherSecret, other.publicId))).status).toBe(
      200,
    );

    await db().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.appId, other.id));
    await expectError(
      await server('/users', {}, secretHeaders(otherSecret, other.publicId)),
      401,
      'api_key_invalid',
    );
  });

  it('refuses browser requests even with a valid key', async () => {
    await expectError(
      await server('/users', {}, { ...secretHeaders(), Origin: EMBED_ORIGIN }),
      403,
      'forbidden',
    );
  });

  it('records lastUsedAt', async () => {
    expect((await server('/users')).status).toBe(200);
    const key = await db().query.apiKeys.findFirst({ where: eq(apiKeys.id, SEED.apiKey.id) });
    expect(key?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('GET /v1/server/users', () => {
  it('paginates every user of the app newest first without duplicates', async () => {
    for (const name of ['bob', 'carol', 'dave', 'erin'])
      await loginWithEmail(`${name}@server.test`);
    const other = await createTestApp({ loginMethods: ['email'] });
    await db()
      .insert(endUsers)
      .values({ id: newId('usr'), appId: other.id });

    const expected = await db().select().from(endUsers).where(eq(endUsers.appId, SEED.app.id));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const res = await server(`/users${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      const page = ServerUserList.parse(await res.json());
      expect(page.users.length).toBeLessThanOrEqual(2);
      for (const user of page.users) {
        expect(user.appId).toBe(SEED.app.id);
        seen.push(user.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(expected.map((u) => u.id).sort());
    const createdAt = new Map(expected.map((u) => [u.id, u.createdAt.getTime()]));
    const times = seen.map((id) => createdAt.get(id) ?? 0);
    expect([...times].sort((a, b) => b - a).map(Math.round)).toEqual(times.map(Math.round));

    const withWallets = ServerUserList.parse(await (await server('/users?limit=100')).json());
    expect(withWallets.users.find((u) => u.id === alice.user.id)?.wallets).toHaveLength(2);
    expect(withWallets.nextCursor).toBeNull();
  });

  it('validates limit and cursor', async () => {
    await expectError(await server('/users?limit=0'), 400, 'validation_failed');
    await expectError(await server('/users?limit=101'), 400, 'validation_failed');
    await expectError(await server('/users?cursor=garbage'), 400, 'validation_failed');
  });
});

describe('POST /v1/server/users/:id/wallets/:wid/sign', () => {
  async function aliceSession() {
    const wallet = aliceDevice.wallet('evm');
    const session = await aliceDevice.createSession(wallet, {
      chain: 'evm',
      expiresIn: '1h',
      allowMessages: true,
    });
    return { wallet, session };
  }

  const signPath = (userId: string, walletId: string) =>
    `/users/${userId}/wallets/${walletId}/sign`;

  it('signs a message and a transaction on behalf of the user', async () => {
    const { wallet, session } = await aliceSession();
    const res = await server(signPath(alice.user.id, wallet.id), {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        request: { kind: 'message', input: { chain: 'evm', message: 'from the backend' } },
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SessionSignOutput.parse(await res.json());
    expect(
      await verifyMessage({
        address: wallet.address as Address,
        message: 'from the backend',
        signature: signature as Hex,
      }),
    ).toBe(true);

    const tx = await server(signPath(alice.user.id, wallet.id), {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        request: {
          kind: 'transaction',
          broadcast: false,
          input: { chain: 'evm', chainId: 84532, to: '0x4200000000000000000000000000000000000006' },
        },
      }),
    });
    expect(tx.status, await tx.clone().text()).toBe(200);
    const { signedTransaction } = SessionSignOutput.parse(await tx.json());
    expect(
      await recoverTransactionAddress({ serializedTransaction: signedTransaction as never }),
    ).toBe(wallet.address);

    const events = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, alice.user.id), eq(usageEvents.type, 'session.signed')));
    expect(events.filter((e) => e.meta?.via === 'server')).toHaveLength(2);
  });

  it('returns 404 unless session, wallet, user and app all line up', async () => {
    const { wallet, session } = await aliceSession();
    const solanaWallet = alice.user.wallets.find((w) => w.chainFamily === 'solana');
    const bob = (await loginWithEmail('bob2@server.test')).body;
    const body = JSON.stringify({
      sessionId: session.id,
      request: { kind: 'message', input: { chain: 'evm', message: 'x' } },
    });

    await expectError(
      await server(signPath(bob.user.id, wallet.id), { method: 'POST', body }),
      404,
      'not_found',
    );
    await expectError(
      await server(signPath(alice.user.id, solanaWallet?.id ?? ''), { method: 'POST', body }),
      404,
      'not_found',
    );
    await expectError(
      await server(signPath('usr_x', wallet.id), { method: 'POST', body }),
      404,
      'not_found',
    );

    const other = await createTestApp();
    const otherSecret = newSecretApiKey();
    await db()
      .insert(apiKeys)
      .values({
        id: newId('key'),
        appId: other.id,
        hash: await sha256Hex(otherSecret),
        prefix: apiKeyPrefix(otherSecret),
      });
    await expectError(
      await server(
        signPath(alice.user.id, wallet.id),
        { method: 'POST', body },
        secretHeaders(otherSecret, other.publicId),
      ),
      404,
      'not_found',
    );
  });

  it('cannot sign an EVM transaction under a Solana session', async () => {
    const wallet = aliceDevice.wallet('solana');
    const session = await aliceDevice.createSession(wallet, { chain: 'solana', expiresIn: '1h' });
    const res = await server(signPath(alice.user.id, wallet.id), {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        request: {
          kind: 'transaction',
          broadcast: false,
          input: { chain: 'evm', chainId: 84532, to: '0x4200000000000000000000000000000000000006' },
        },
      }),
    });
    await expectError(res, 403, 'policy_violation');
  });

  it('signs nothing without a session, or once the user revoked it', async () => {
    const { wallet, session } = await aliceSession();
    const noSession = await server(signPath(alice.user.id, wallet.id), {
      method: 'POST',
      body: JSON.stringify({
        request: { kind: 'message', input: { chain: 'evm', message: 'x' } },
      }),
    });
    await expectError(noSession, 400, 'validation_failed');

    const revoke = await request(`/v1/sessions/${session.id}`, {
      method: 'DELETE',
      headers: bearer(alice.accessToken),
    });
    expect(revoke.status).toBe(200);
    const revoked = await server(signPath(alice.user.id, wallet.id), {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        request: { kind: 'message', input: { chain: 'evm', message: 'x' } },
      }),
    });
    await expectError(revoked, 403, 'policy_violation');
  });
});

describe('POST /v1/server/webhooks/test', () => {
  it('is not implemented before webhooks exist', async () => {
    await expectError(await server('/webhooks/test', { method: 'POST' }), 501, 'bad_request');
  });
});
