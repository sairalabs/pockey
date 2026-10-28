import { ed25519 } from '@noble/curves/ed25519.js';
import type { EvmRpc } from '@pockey/chains-evm';
import { SYSTEM_PROGRAM_ID, type SolanaRpc } from '@pockey/chains-solana';
import { sessionSigners, usageEvents } from '@pockey/db';
import { KeyProviderError, type KeyProvider } from '@pockey/key-provider';
import {
  buildCreateSigner,
  buildGrantRevoke,
  buildSessionPolicy,
  generateSessionKey,
} from '@pockey/key-provider/client';
import {
  ApiErrorBody,
  SessionList,
  SessionSignOutput,
  SignerSetupOutput,
  SessionSigner,
  type SessionSignRequestInput,
  type SigningPolicy,
  type Wallet,
} from '@pockey/types';
import { base58, base64 } from '@scure/base';
import { and, eq } from 'drizzle-orm';
import {
  recoverTransactionAddress,
  serializeTransaction,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';
import { getEmulator, getKeyProvider } from '../src/lib/key-provider.js';
import { setRpcFactory } from '../src/lib/rpc.js';
import { expireSessions } from '../src/services/sessions.js';
import type { Device } from './device.js';
import { bearer, db, env, loginWithEmail, mailer, postJson, request, seedDb } from './helpers.js';

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

let device: Device;
let evm: Wallet;
let solana: Wallet;

const send = (method: string, path: string, body?: unknown, token = device.accessToken) =>
  request(path, {
    method,
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const policyFor = (wallet: Wallet, policy: Partial<SigningPolicy> = {}) => ({
  chain: wallet.chainFamily,
  expiresIn: '1h',
  ...policy,
});

function createSession(
  policy: Partial<SigningPolicy>,
  wallet: Wallet = evm,
  owner: Device = device,
): Promise<SessionSigner> {
  return owner.createSession(wallet, policyFor(wallet, policy));
}

const sign = (sessionId: string, body: SessionSignRequestInput, token = device.accessToken) =>
  send('POST', `/v1/sessions/${sessionId}/sign`, body, token);

async function expectViolation(res: Response, reason: string): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(403);
  const { error } = ApiErrorBody.parse(await res.json());
  expect(error.code).toBe('policy_violation');
  expect(error.details).toEqual({ reason });
}

async function expectReason(res: Response, status: number, reason: string): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(status);
  expect(ApiErrorBody.parse(await res.json()).error.details).toMatchObject({ reason });
}

const evmSend = (
  overrides: Record<string, unknown> = {},
): Extract<SessionSignRequestInput, { kind: 'transaction' }> => ({
  kind: 'transaction',
  input: { chain: 'evm', chainId: 8453, to: WETH, ...overrides } as never,
});

async function sessionRow(sessionId: string) {
  const row = await db().query.sessionSigners.findFirst({
    where: eq(sessionSigners.id, sessionId),
  });
  if (!row) throw new Error('no session row');
  return row;
}

const spentTotal = async (sessionId: string) => (await sessionRow(sessionId)).spentTotal;

/** Past the provider propagation window, so refusals are not retried for 5 seconds. */
async function settle(sessionId: string): Promise<void> {
  await db()
    .update(sessionSigners)
    .set({ createdAt: new Date(Date.now() - 60_000) })
    .where(eq(sessionSigners.id, sessionId));
}

function provider(): KeyProvider {
  return getKeyProvider(parseEnv(env), mailer());
}

const policiesOf = (owner: Device) =>
  getEmulator().inspect(owner.keySession.organizationId).policies;

async function freshUser(name: string): Promise<Device> {
  return (await loginWithEmail(`${name}-${crypto.randomUUID().slice(0, 8)}@sessions.test`)).device;
}

async function providerError(run: Promise<unknown>): Promise<KeyProviderError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(KeyProviderError);
  return error as KeyProviderError;
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

const unsignedEvmTx = () =>
  serializeTransaction({
    type: 'eip1559',
    chainId: 8453,
    nonce: 0,
    gas: 21_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    to: WETH,
    value: 0n,
  });

beforeAll(async () => {
  await seedDb();
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  device = (await loginWithEmail('sessions@test.dev')).device;
  evm = device.wallet('evm');
  solana = device.wallet('solana');
});

afterAll(() => {
  setRpcFactory(undefined);
});

beforeEach(() => {
  sentEvm.length = 0;
  sentSolana.length = 0;
  failNextSend = false;
});

describe('session signer setup', () => {
  it('adds the Pockey signer once and grants it revocation only', async () => {
    const owner = await freshUser('setup');
    expect(owner.keySession.signerUserId).toBeNull();
    const before = policiesOf(owner);
    const signerUserId = await owner.ensureSigner();
    expect(getEmulator().inspect(owner.keySession.organizationId).users).toBe(2);
    expect(policiesOf(owner)).toBe(before + 1);

    // Idempotent: the stored signer is returned, nothing is relayed again.
    const again = await postJson(
      '/v1/sessions/signer',
      {
        createSigner: await owner.stamp(
          buildCreateSigner({
            organizationId: owner.keySession.organizationId,
            signerPublicKey: (await generateSessionKey()).publicKey,
          }),
        ),
      },
      owner.headers(),
    );
    expect(again.status, await again.clone().text()).toBe(200);
    expect(SignerSetupOutput.parse(await again.json()).signerUserId).toBe(signerUserId);
    expect(getEmulator().inspect(owner.keySession.organizationId).users).toBe(2);
  });

  it('refuses a signer that is not the Pockey signer key, or a wider grant', async () => {
    const owner = await freshUser('rogue-signer');
    const rogue = await postJson(
      '/v1/sessions/signer',
      {
        createSigner: await owner.stamp(
          buildCreateSigner({
            organizationId: owner.keySession.organizationId,
            signerPublicKey: (await generateSessionKey()).publicKey,
          }),
        ),
      },
      owner.headers(),
    );
    await expectReason(rogue, 400, 'unexpected_request');
    expect(getEmulator().inspect(owner.keySession.organizationId).users).toBe(1);

    const noSigner = await postJson(
      '/v1/sessions/signer/permission',
      {
        request: await owner.stamp(
          buildGrantRevoke({ organizationId: owner.keySession.organizationId, signerUserId: 'x' }),
        ),
      },
      owner.headers(),
    );
    expect(noSigner.status).toBe(400);

    await owner.ensureSigner();
    const wrongUser = await postJson(
      '/v1/sessions/signer/permission',
      {
        request: await owner.stamp(
          buildGrantRevoke({
            organizationId: owner.keySession.organizationId,
            signerUserId: owner.keySession.userId,
          }),
        ),
      },
      owner.headers(),
    );
    await expectReason(wrongUser, 400, 'unexpected_request');
  });
});

describe('session CRUD', () => {
  it('creates, lists newest first, and revokes idempotently', async () => {
    await device.ensureSigner();
    const policiesBefore = policiesOf(device);
    const before = Date.now();
    const first = await createSession({ maxValuePerTx: '1000' });
    const second = await createSession({ allowedChains: [84532] });
    expect(first.spentTotal).toBe('0');
    expect(first.revokedAt).toBeNull();
    const expiresIn = Date.parse(first.expiresAt) - before;
    expect(expiresIn).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(expiresIn).toBeLessThanOrEqual(3_600_000 + 5000);
    expect(policiesOf(device)).toBe(policiesBefore + 2);

    const revoke = await send('DELETE', `/v1/sessions/${first.id}`);
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true });
    expect(policiesOf(device)).toBe(policiesBefore + 1);
    const again = await send('DELETE', `/v1/sessions/${first.id}`);
    expect(again.status).toBe(200);
    expect(policiesOf(device)).toBe(policiesBefore + 1);

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
    const policiesBefore = policiesOf(device);
    for (const [wallet, policy] of cases) {
      const res = await send(
        'POST',
        '/v1/sessions',
        await device.sessionBody(wallet, policyFor(wallet, policy)),
      );
      expect(res.status, JSON.stringify(policy)).toBe(400);
      expect(ApiErrorBody.parse(await res.json()).error.code).toBe('validation_failed');
    }
    expect(policiesOf(device)).toBe(policiesBefore);
  });

  it('refuses a stamped policy wider than, or different from, the declared one', async () => {
    const policiesBefore = policiesOf(device);
    const declared = policyFor(evm, { maxValuePerTx: '100', allowedContracts: [WETH] as never });

    const wider = await device.sessionBody(evm, declared, { stampPolicy: policyFor(evm) });
    await expectReason(await send('POST', '/v1/sessions', wider), 400, 'unexpected_request');

    const withMessages = await device.sessionBody(evm, declared, {
      stampPolicy: { ...declared, allowMessages: true },
    });
    await expectReason(await send('POST', '/v1/sessions', withMessages), 400, 'unexpected_request');

    const legit = await device.sessionBody(evm, declared);
    await expectReason(
      await send('POST', '/v1/sessions', {
        ...legit,
        expiresAt: new Date(Date.parse(legit.expiresAt) + 60_000).toISOString(),
      }),
      400,
      'unexpected_request',
    );
    await expectReason(
      await send('POST', '/v1/sessions', { ...legit, policyName: 'pockey:ses:another0000' }),
      400,
      'unexpected_request',
    );
    await expectReason(
      await send('POST', '/v1/sessions', { ...legit, policy: policyFor(evm) }),
      400,
      'unexpected_request',
    );
    expect(policiesOf(device)).toBe(policiesBefore);
    expect((await send('POST', '/v1/sessions', legit)).status).toBe(201);
  });

  it('refuses an expiry that is not the one the user consented to', async () => {
    const body = await device.sessionBody(evm, policyFor(evm), {
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    const res = await send('POST', '/v1/sessions', body);
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('validation_failed');
  });

  it('needs the signer set up first', async () => {
    const owner = await freshUser('no-signer');
    const wallet = owner.wallet('evm');
    const expiresAt = new Date(Date.now() + 3600_000);
    const policyName = 'pockey:ses:nosigner0000';
    const body = {
      walletId: wallet.id,
      policy: policyFor(wallet),
      policyName,
      expiresAt: expiresAt.toISOString(),
      request: await owner.stamp(
        buildSessionPolicy({
          organizationId: owner.keySession.organizationId,
          policyName,
          policy: policyFor(wallet),
          walletId: owner.keySession.accounts.evm.walletId,
          address: wallet.address,
          signerUserId: 'not-set-up',
          expiresAt,
        }),
      ),
    };
    await expectReason(
      await send('POST', '/v1/sessions', body, owner.accessToken),
      400,
      'signer_missing',
    );
  });

  it("hides other users' wallets and sessions behind a 404", async () => {
    const mine = await createSession({ allowMessages: true });
    const stranger = await freshUser('stranger');

    const onMyWallet = await send(
      'POST',
      '/v1/sessions',
      await stranger.sessionBody(evm, policyFor(evm)),
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
      .where(
        and(eq(usageEvents.endUserId, device.auth.user.id), eq(usageEvents.type, 'session.signed')),
      );
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
    expect(await recoverTransactionAddress({ serializedTransaction: sentEvm[0] as never })).toBe(
      evm.address,
    );
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

  it('refuses sponsored transactions while the app keeps sponsoring disabled', async () => {
    const session = await createSession({});
    const res = await sign(session.id, { ...evmSend(), sponsored: true });
    expect(res.status).toBe(403);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('forbidden');
    expect(sentEvm).toHaveLength(0);
  });
});

/* The provider is the real barrier: these users have one session at most, since the
   provider ORs every policy of the signer in a sub-organization. */
describe('what the key provider enforces on its own', () => {
  it('maps a provider refusal to provider_denied', async () => {
    const owner = await freshUser('deleted-policy');
    const session = await createSession({ allowMessages: true }, owner.wallet('evm'), owner);
    const row = await sessionRow(session.id);
    await settle(session.id);
    await provider().deletePolicy({
      subOrgId: owner.keySession.organizationId,
      policyId: row.keyProviderPolicyId,
    });
    await expectViolation(
      await sign(
        session.id,
        { kind: 'message', input: { chain: 'evm', message: 'x' } },
        owner.accessToken,
      ),
      'provider_denied',
    );
  });

  it('refuses after the expiry written in the policy, whatever Pockey thinks', async () => {
    const owner = await freshUser('native-expiry');
    const wallet = owner.wallet('evm');
    const policy = policyFor(wallet, { expiresIn: '1m', allowMessages: true });
    const body = await owner.sessionBody(wallet, policy, {
      expiresAt: new Date(Date.now() - 2 * 60_000),
    });
    const res = await send('POST', '/v1/sessions', body, owner.accessToken);
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = SessionSigner.parse(await res.json());

    // Pretend the local mirror is still live: only the provider stands in the way.
    await db()
      .update(sessionSigners)
      .set({ expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(Date.now() - 60_000) })
      .where(eq(sessionSigners.id, id));
    await expectViolation(
      await sign(
        id,
        { kind: 'message', input: { chain: 'evm', message: 'late' } },
        owner.accessToken,
      ),
      'provider_denied',
    );
  });

  it('signs nothing for Pockey without a session policy', { timeout: 20_000 }, async () => {
    const owner = await freshUser('no-session');
    const wallet = owner.wallet('evm');
    const signRaw = (scope: Parameters<KeyProvider['signRaw']>[0]['scope']) =>
      provider().signRaw({
        subOrgId: owner.keySession.organizationId,
        address: wallet.address,
        payload: new Uint8Array(32).fill(1),
        encoding: 'hash',
        scope,
      });
    const past = { kind: 'session', policyId: 'none', policyCreatedAt: new Date(0) } as const;

    // Before the user added the signer, Pockey's key is unknown in the sub-organization.
    expect((await providerError(signRaw(past))).code).not.toBe('unknown');

    // With the signer but no policy, it has no power, even as a "system" signer.
    await owner.ensureSigner();
    expect((await providerError(signRaw(past))).code).toBe('policy_denied');
    expect((await providerError(signRaw({ kind: 'system' }))).code).toBe('policy_denied');
    const transaction = provider().signTransaction({
      subOrgId: owner.keySession.organizationId,
      address: wallet.address,
      chainFamily: 'evm',
      unsignedTransaction: unsignedEvmTx(),
      scope: past,
    });
    expect((await providerError(transaction)).code).toBe('policy_denied');

    // And none once the only session is revoked.
    const session = await createSession({ allowMessages: true }, wallet, owner);
    const { keyProviderPolicyId } = await sessionRow(session.id);
    const scope = {
      kind: 'session',
      policyId: keyProviderPolicyId,
      policyCreatedAt: new Date(),
    } as const;
    expect((await signRaw(scope)).signature).toHaveLength(65);
    expect(
      (await send('DELETE', `/v1/sessions/${session.id}`, undefined, owner.accessToken)).status,
    ).toBe(200);
    expect((await providerError(signRaw({ ...scope, policyCreatedAt: new Date(0) }))).code).toBe(
      'policy_denied',
    );
  });

  it('does not let a Solana session sign for the EVM account', async () => {
    const owner = await freshUser('solana-only');
    const solanaWallet = owner.wallet('solana');
    const evmWallet = owner.wallet('evm');
    // No program allowlist: any Solana transaction of this account is fine.
    const session = await createSession({}, solanaWallet, owner);
    const { keyProviderPolicyId } = await sessionRow(session.id);

    const evmRequest = await sign(session.id, evmSend(), owner.accessToken);
    await expectViolation(evmRequest, 'wallet_mismatch');

    const scope = {
      kind: 'session',
      policyId: keyProviderPolicyId,
      policyCreatedAt: new Date(),
    } as const;
    const solanaSigned = await provider().signTransaction({
      subOrgId: owner.keySession.organizationId,
      address: solanaWallet.address,
      chainFamily: 'solana',
      unsignedTransaction: solanaTx(solanaWallet.address, [{ program: SYSTEM_PROGRAM_ID }]),
      scope,
    });
    expect(solanaSigned.signedTransaction.length).toBeGreaterThan(0);

    const late = { ...scope, policyCreatedAt: new Date(0) };
    const evmTransaction = provider().signTransaction({
      subOrgId: owner.keySession.organizationId,
      address: evmWallet.address,
      chainFamily: 'evm',
      unsignedTransaction: unsignedEvmTx(),
      scope: late,
    });
    expect((await providerError(evmTransaction)).code).toBe('policy_denied');
    const evmRaw = provider().signRaw({
      subOrgId: owner.keySession.organizationId,
      address: evmWallet.address,
      payload: new Uint8Array(32).fill(2),
      encoding: 'hash',
      scope: late,
    });
    expect((await providerError(evmRaw)).code).toBe('policy_denied');
  });

  it('enforces the EVM policy conditions at the provider too', async () => {
    const owner = await freshUser('evm-conditions');
    const wallet = owner.wallet('evm');
    const session = await createSession(
      { allowedContracts: [USDC] as never, maxValuePerTx: '10' },
      wallet,
      owner,
    );
    const { keyProviderPolicyId } = await sessionRow(session.id);
    const late = {
      kind: 'session',
      policyId: keyProviderPolicyId,
      policyCreatedAt: new Date(0),
    } as const;
    await settle(session.id);

    // To WETH, not allowlisted, and a raw hash while messages are off.
    const tx = provider().signTransaction({
      subOrgId: owner.keySession.organizationId,
      address: wallet.address,
      chainFamily: 'evm',
      unsignedTransaction: unsignedEvmTx(),
      scope: late,
    });
    expect((await providerError(tx)).code).toBe('policy_denied');
    const raw = provider().signRaw({
      subOrgId: owner.keySession.organizationId,
      address: wallet.address,
      payload: new Uint8Array(32).fill(3),
      encoding: 'hash',
      scope: late,
    });
    expect((await providerError(raw)).code).toBe('policy_denied');
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

  it('refuses an EVM transaction under a Solana session', async () => {
    const session = await createSession({}, solana);
    await expectViolation(await sign(session.id, evmSend()), 'wallet_mismatch');
    await expectViolation(
      await sign(session.id, { kind: 'message', input: { chain: 'evm', message: 'gm' } }),
      'wallet_mismatch',
    );
    expect(sentEvm).toHaveLength(0);
  });
});

describe('expireSessions (hourly cron)', () => {
  it('revokes expired sessions and deletes their provider policy', async () => {
    const owner = await freshUser('cron');
    const wallet = owner.wallet('evm');
    const session = await createSession({}, wallet, owner);
    const live = await createSession({}, wallet, owner);
    const policiesBefore = policiesOf(owner);
    const policyId = (await sessionRow(session.id)).keyProviderPolicyId;
    await db()
      .update(sessionSigners)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessionSigners.id, session.id));

    const result = await expireSessions(db(), provider(), new Date());
    expect(result.failed).toBe(0);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    expect((await sessionRow(session.id)).revokedAt).not.toBeNull();
    expect((await sessionRow(live.id)).revokedAt).toBeNull();
    expect(policiesOf(owner)).toBe(policiesBefore - 1);
    const gone = provider().deletePolicy({ subOrgId: owner.keySession.organizationId, policyId });
    expect((await providerError(gone)).code).toBe('not_found');

    // Idempotent: nothing left to expire for this session.
    const second = await expireSessions(db(), provider(), new Date());
    expect(second.failed).toBe(0);
    expect(policiesOf(owner)).toBe(policiesBefore - 1);
  });
});
