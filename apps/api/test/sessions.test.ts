import { ed25519 } from '@noble/curves/ed25519.js';
import type { EvmRpc } from '@pocketkey/chains-evm';
import { SYSTEM_PROGRAM_ID, type SolanaRpc } from '@pocketkey/chains-solana';
import { endUsers, sessionSigners, usageEvents } from '@pocketkey/db';
import { MockKeyProvider } from '@pocketkey/key-provider/mock';
import {
  ApiErrorBody,
  SessionList,
  SessionSigner,
  SessionSignOutput,
  type AuthResponse,
  type SessionSignRequestInput,
  type SigningPolicy,
  type Wallet,
} from '@pocketkey/types';
import { base58, base64 } from '@scure/base';
import { and, eq } from 'drizzle-orm';
import {
  recoverTransactionAddress,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';
import { getKeyProvider } from '../src/lib/key-provider.js';
import { setRpcFactory } from '../src/lib/rpc.js';
import { expireSessions } from '../src/services/sessions.js';
import { bearer, db, env, loginWithEmail, request, seedDb } from './helpers.js';

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EVM_HASH = '0xabababababababababababababababababababababababababababababababab';

/* Fake RPCs. `failNextSend` makes the next broadcast throw once. */
const sentEvm: Hex[] = [];
const sentSolana: Uint8Array[] = [];
let failNextSend = false;
const fakeEvm: EvmRpc = {
  getTransactionCount: async () => 3,
  estimateGas: async () => 21_000n,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1n }),
  sendRawTransaction: async (serialized) => {
    if (failNextSend) {
      failNextSend = false;
      throw new Error('nonce too low');
    }
    sentEvm.push(serialized);
    return EVM_HASH;
  },
};
const fakeSolana: SolanaRpc = {
  getLatestBlockhash: async () => ({
    blockhash: base58.encode(new Uint8Array(32)),
    lastValidBlockHeight: 1,
  }),
  sendRawTransaction: async (bytes) => {
    sentSolana.push(bytes);
    return 'ignored';
  },
};

let login: AuthResponse;
let evm: Wallet;
let solana: Wallet;

function walletOf(auth: AuthResponse, family: 'evm' | 'solana'): Wallet {
  const wallet = auth.user.wallets.find((w) => w.chainFamily === family);
  if (!wallet) throw new Error(`missing ${family} wallet`);
  return wallet;
}

const send = (method: string, path: string, body?: unknown, token = login.accessToken) =>
  request(path, {
    method,
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function createSession(
  policy: Partial<SigningPolicy>,
  wallet: Wallet = evm,
  token = login.accessToken,
): Promise<SessionSigner> {
  const res = await send(
    'POST',
    '/v1/sessions',
    { walletId: wallet.id, policy: { chain: wallet.chainFamily, expiresIn: '1h', ...policy } },
    token,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return SessionSigner.parse(await res.json());
}

const sign = (sessionId: string, body: SessionSignRequestInput, token = login.accessToken) =>
  send('POST', `/v1/sessions/${sessionId}/sign`, body, token);

async function expectViolation(res: Response, reason: string): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(403);
  const { error } = ApiErrorBody.parse(await res.json());
  expect(error.code).toBe('policy_violation');
  expect(error.details).toEqual({ reason });
}

const evmSend = (
  overrides: Record<string, unknown> = {},
): Extract<SessionSignRequestInput, { kind: 'transaction' }> => ({
  kind: 'transaction',
  input: { chain: 'evm', chainId: 8453, to: WETH, ...overrides } as never,
});

async function spentTotal(sessionId: string): Promise<string | undefined> {
  const row = await db().query.sessionSigners.findFirst({
    where: eq(sessionSigners.id, sessionId),
  });
  return row?.spentTotal;
}

function mockProvider(): MockKeyProvider {
  const provider = getKeyProvider(parseEnv(env));
  if (!(provider instanceof MockKeyProvider)) throw new Error('Tests expect KEY_PROVIDER=mock');
  return provider;
}

async function subOrgOf(endUserId: string): Promise<string> {
  const user = await db().query.endUsers.findFirst({ where: eq(endUsers.id, endUserId) });
  if (!user?.keyProviderSubOrgId) throw new Error('no sub-org');
  return user.keyProviderSubOrgId;
}

/** Legacy transaction from `payer`: header, keys, blockhash, instructions. Programs are readonly. */
function solanaTx(payer: string, instructions: { program: string; lamports?: bigint }[]): string {
  const programs = [...new Set(instructions.map((ix) => ix.program))];
  const recipient = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const keys = [base58.decode(payer), recipient, ...programs.map((p) => base58.decode(p))];
  const message: number[] = [1, 0, programs.length, keys.length, ...keys.flatMap((k) => [...k])];
  message.push(...new Uint8Array(32).fill(7), instructions.length);
  for (const ix of instructions) {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);
    view.setBigUint64(4, ix.lamports ?? 0n, true);
    message.push(2 + programs.indexOf(ix.program), 2, 0, 1, data.length, ...data);
  }
  return base64.encode(Uint8Array.from([1, ...new Uint8Array(64), ...message]));
}

beforeAll(async () => {
  await seedDb();
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  login = (await loginWithEmail('sessions@test.dev')).body;
  evm = walletOf(login, 'evm');
  solana = walletOf(login, 'solana');
});

afterAll(() => {
  setRpcFactory(undefined);
});

beforeEach(() => {
  sentEvm.length = 0;
  sentSolana.length = 0;
  failNextSend = false;
});

describe('session CRUD (T4.2)', () => {
  it('creates, lists newest first, and revokes idempotently', async () => {
    const before = Date.now();
    const first = await createSession({ maxValuePerTx: '1000' });
    const second = await createSession({ allowedChains: [84532] });
    expect(first.spentTotal).toBe('0');
    expect(first.revokedAt).toBeNull();
    const expiresIn = Date.parse(first.expiresAt) - before;
    expect(expiresIn).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(expiresIn).toBeLessThanOrEqual(3_600_000 + 5000);

    const subOrgId = await subOrgOf(login.user.id);
    const policyIds = async () =>
      mockProvider()
        .policyRecordsOf(subOrgId)
        .map((p) => p.policyId);
    const firstRow = await db().query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, first.id),
    });
    expect(await policyIds()).toContain(firstRow?.keyProviderPolicyId);

    const revoke = await send('DELETE', `/v1/sessions/${first.id}`);
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true });
    expect(await policyIds()).not.toContain(firstRow?.keyProviderPolicyId);
    const again = await send('DELETE', `/v1/sessions/${first.id}`);
    expect(again.status).toBe(200);

    const list = await send('GET', '/v1/sessions');
    const { sessions } = SessionList.parse(await list.json());
    const ids = sessions.map((s) => s.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(sessions.find((s) => s.id === first.id)?.revokedAt).not.toBeNull();
    expect(sessions.find((s) => s.id === second.id)?.revokedAt).toBeNull();
  });

  it('validates the policy against the wallet and the app', async () => {
    const cases: [Wallet, Record<string, unknown>][] = [
      [evm, { chain: 'solana' }],
      [evm, { allowedPrograms: [SYSTEM_PROGRAM_ID] }],
      [solana, { allowedContracts: [WETH] }],
      [solana, { allowedChains: [8453] }],
      [evm, { allowedChains: [1] }],
      [evm, { expiresIn: '31d' }],
    ];
    for (const [wallet, policy] of cases) {
      const res = await send('POST', '/v1/sessions', {
        walletId: wallet.id,
        policy: { chain: wallet.chainFamily, expiresIn: '1h', ...policy },
      });
      expect(res.status, JSON.stringify(policy)).toBe(400);
      expect(ApiErrorBody.parse(await res.json()).error.code).toBe('validation_failed');
    }
  });

  it("hides other users' wallets and sessions behind a 404", async () => {
    const mine = await createSession({});
    const stranger = (await loginWithEmail('session-stranger@test.dev')).body;

    const onMyWallet = await send(
      'POST',
      '/v1/sessions',
      { walletId: evm.id, policy: { chain: 'evm', expiresIn: '1h' } },
      stranger.accessToken,
    );
    expect(onMyWallet.status).toBe(404);

    const list = await send('GET', '/v1/sessions', undefined, stranger.accessToken);
    expect(SessionList.parse(await list.json()).sessions).toEqual([]);

    const signAsStranger = await sign(
      mine.id,
      { kind: 'message', input: { chain: 'evm', message: 'gm' } },
      stranger.accessToken,
    );
    expect(signAsStranger.status).toBe(404);
    expect(
      (await send('DELETE', `/v1/sessions/${mine.id}`, undefined, stranger.accessToken)).status,
    ).toBe(404);
    expect((await send('DELETE', '/v1/sessions/not-an-id')).status).toBe(404);
  });
});

describe('signing under a session', () => {
  it('refuses messages when the session does not allow them', async () => {
    const session = await createSession({});
    await expectViolation(
      await sign(session.id, { kind: 'message', input: { chain: 'evm', message: 'gm' } }),
      'messages_not_allowed',
    );
  });

  it('signs a message that viem verifies and records session.signed', async () => {
    const session = await createSession({ allowMessages: true });
    const res = await sign(session.id, {
      kind: 'message',
      input: { chain: 'evm', message: 'gm session' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature, sponsored } = SessionSignOutput.parse(await res.json());
    expect(sponsored).toBe(false);
    expect(
      await verifyMessage({
        address: evm.address as Address,
        message: 'gm session',
        signature: signature as Hex,
      }),
    ).toBe(true);

    const events = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, login.user.id), eq(usageEvents.type, 'session.signed')));
    expect(
      events.some((event) => event.meta?.sessionId === session.id && event.meta.via === 'user'),
    ).toBe(true);
  });

  it('signs typed data only for an allowlisted verifying contract', async () => {
    const domain = { name: 'Token', version: '1', chainId: 8453, verifyingContract: USDC };
    const types = { Ping: [{ name: 'value', type: 'uint256' }] };
    const typed = {
      chain: 'evm' as const,
      domain,
      types,
      primaryType: 'Ping',
      message: { value: '1' },
    };
    const open = await createSession({ allowMessages: true });
    await expectViolation(
      await sign(open.id, { kind: 'typedData', input: typed }),
      'typed_data_not_allowed',
    );

    const allowlisted = await createSession({
      allowedContracts: [USDC.toLowerCase()] as never,
      allowMessages: true,
    });
    const res = await sign(allowlisted.id, { kind: 'typedData', input: typed });
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SessionSignOutput.parse(await res.json());
    expect(
      await verifyTypedData({
        address: evm.address as Address,
        domain: { ...domain, verifyingContract: USDC },
        types,
        primaryType: 'Ping',
        message: { value: 1n },
        signature: signature as Hex,
      }),
    ).toBe(true);
  });

  it('refuses chains, contracts and per transaction values outside the policy', async () => {
    const session = await createSession({
      allowedChains: [84532],
      allowedContracts: [WETH] as never,
      maxValuePerTx: '100',
    });
    await expectViolation(await sign(session.id, evmSend({ chainId: 8453 })), 'chain_not_allowed');
    await expectViolation(await sign(session.id, evmSend({ chainId: 1 })), 'chain_not_allowed');
    await expectViolation(
      await sign(session.id, evmSend({ chainId: 84532, to: USDC })),
      'contract_not_allowed',
    );
    await expectViolation(
      await sign(session.id, evmSend({ chainId: 84532, value: '101' })),
      'value_per_tx_exceeded',
    );
    expect(sentEvm).toHaveLength(0);

    const ok = await sign(session.id, evmSend({ chainId: 84532, value: '100' }));
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(SessionSignOutput.parse(await ok.json())).toEqual({ hash: EVM_HASH, sponsored: false });
    expect(sentEvm).toHaveLength(1);
  });

  it('caps the total across sends and releases the reservation when broadcast fails', async () => {
    const session = await createSession({ maxValueTotal: '1500' });

    failNextSend = true;
    const failed = await sign(session.id, evmSend({ value: '1000' }));
    expect(failed.status).toBe(400);
    expect(await spentTotal(session.id)).toBe('0');

    expect((await sign(session.id, evmSend({ value: '1000' }))).status).toBe(200);
    expect(await spentTotal(session.id)).toBe('1000');
    await expectViolation(
      await sign(session.id, evmSend({ value: '1000' })),
      'value_total_exceeded',
    );
    expect(await spentTotal(session.id)).toBe('1000');

    const unbroadcast = await sign(session.id, { ...evmSend({ value: '500' }), broadcast: false });
    expect(unbroadcast.status).toBe(200);
    const { signedTransaction } = SessionSignOutput.parse(await unbroadcast.json());
    expect(
      await recoverTransactionAddress({ serializedTransaction: signedTransaction as never }),
    ).toBe(evm.address);
    expect(await spentTotal(session.id)).toBe('1500');
    expect(sentEvm).toHaveLength(1);
  });

  it('refuses a session whose expiry passed', async () => {
    const session = await createSession({});
    await db()
      .update(sessionSigners)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessionSigners.id, session.id));
    await expectViolation(
      await sign(session.id, { kind: 'message', input: { chain: 'evm', message: 'late' } }),
      'session_expired',
    );
  });

  it('applies revocation immediately', async () => {
    const session = await createSession({ allowMessages: true });
    const body: SessionSignRequestInput = {
      kind: 'message',
      input: { chain: 'evm', message: 'once' },
    };
    expect((await sign(session.id, body)).status).toBe(200);
    expect((await send('DELETE', `/v1/sessions/${session.id}`)).status).toBe(200);
    await expectViolation(await sign(session.id, body), 'session_revoked');
  });

  it('maps a provider refusal to provider_denied', async () => {
    const session = await createSession({ allowMessages: true });
    const row = await db().query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, session.id),
    });
    await mockProvider().deletePolicy({
      subOrgId: await subOrgOf(login.user.id),
      policyId: row?.keyProviderPolicyId ?? '',
    });
    await expectViolation(
      await sign(session.id, { kind: 'message', input: { chain: 'evm', message: 'x' } }),
      'provider_denied',
    );
  });

  it('refuses sponsored transactions while the app keeps sponsoring disabled', async () => {
    const session = await createSession({});
    const res = await sign(session.id, { ...evmSend(), sponsored: true });
    expect(res.status).toBe(403);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('forbidden');
    expect(sentEvm).toHaveLength(0);
  });
});

describe('Solana sessions', () => {
  it('enforces the program allowlist and signs allowed transfers', async () => {
    const other = base58.encode(new Uint8Array(32).fill(5));
    const narrow = await createSession({ allowedPrograms: [other] as never }, solana);
    const transfer = solanaTx(solana.address, [{ program: SYSTEM_PROGRAM_ID, lamports: 10n }]);
    await expectViolation(
      await sign(narrow.id, {
        kind: 'transaction',
        input: { chain: 'solana', cluster: 'devnet', transaction: transfer },
      }),
      'program_not_allowed',
    );

    const system = await createSession(
      { allowedPrograms: [SYSTEM_PROGRAM_ID] as never, maxValuePerTx: '10' },
      solana,
    );
    const tooMuch = solanaTx(solana.address, [{ program: SYSTEM_PROGRAM_ID, lamports: 11n }]);
    await expectViolation(
      await sign(system.id, {
        kind: 'transaction',
        input: { chain: 'solana', cluster: 'devnet', transaction: tooMuch },
      }),
      'value_per_tx_exceeded',
    );

    const res = await sign(system.id, {
      kind: 'transaction',
      input: { chain: 'solana', cluster: 'devnet', transaction: transfer },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { hash } = SessionSignOutput.parse(await res.json());
    expect(sentSolana).toHaveLength(1);
    const sent = sentSolana[0] ?? new Uint8Array();
    const signature = sent.slice(1, 65);
    expect(ed25519.verify(signature, sent.slice(65), base58.decode(solana.address))).toBe(true);
    expect(hash).toBe(base58.encode(signature));
    expect(await spentTotal(system.id)).toBe('10');
  });
});

describe('expireSessions (hourly cron)', () => {
  it('revokes expired sessions and deletes their provider policy', async () => {
    const session = await createSession({});
    const live = await createSession({});
    const row = await db().query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, session.id),
    });
    const policyId = row?.keyProviderPolicyId;
    await db()
      .update(sessionSigners)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessionSigners.id, session.id));

    const provider = mockProvider();
    const result = await expireSessions(db(), provider, new Date());
    expect(result.failed).toBe(0);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const after = await db().query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, session.id),
    });
    expect(after?.revokedAt).not.toBeNull();
    const liveRow = await db().query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, live.id),
    });
    expect(liveRow?.revokedAt).toBeNull();
    const remaining = provider
      .policyRecordsOf(await subOrgOf(login.user.id))
      .map((p) => p.policyId);
    expect(remaining).not.toContain(policyId);
    expect(remaining).toContain(liveRow?.keyProviderPolicyId);

    // Idempotent: nothing left to expire for this session.
    const second = await expireSessions(db(), provider, new Date());
    expect(second.failed).toBe(0);
  });
});
