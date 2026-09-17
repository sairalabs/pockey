import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { serializeUnsignedTransaction } from '@pocketkey/chains-evm';
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '@pocketkey/chains-solana';
import type { SigningPolicy } from '@pocketkey/types';
import { base58, base64 } from '@scure/base';
import {
  getAddress,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  type Address,
  type Hex,
} from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockKeyProvider, type MockKeyProvider } from './index.js';

const WETH = '0x4200000000000000000000000000000000000006';
const OTHER_PROGRAM = base58.encode(new Uint8Array(32).fill(5));
const HOUR = 3_600_000;

let clock = new Date('2026-09-17T12:00:00Z');
let kp: MockKeyProvider;
let subOrgId: string;
let evm: { walletId: string; address: string };
let sol: { walletId: string; address: string };

beforeEach(async () => {
  clock = new Date('2026-09-17T12:00:00Z');
  kp = createMockKeyProvider({ now: () => clock });
  ({ subOrgId } = await kp.createSubOrganization({
    endUserId: 'usr_test',
    auth: { type: 'email', email: 'a@b.co' },
  }));
  evm = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
  sol = await kp.createWallet({ subOrgId, curve: 'ed25519' });
});

const inOneHour = () => new Date(clock.getTime() + HOUR);

async function policyFor(walletId: string, policy: SigningPolicy): Promise<string> {
  const { policyId } = await kp.createPolicy({
    subOrgId,
    walletId,
    policy,
    expiresAt: inOneHour(),
  });
  return policyId;
}

function evmTx(overrides: { chainId?: 8453 | 84532; to?: Address; value?: bigint } = {}): Hex {
  return serializeUnsignedTransaction({
    chainId: overrides.chainId ?? 8453,
    to: overrides.to ?? getAddress(WETH),
    value: overrides.value ?? 0n,
    data: '0x',
    nonce: 1,
    gas: 21_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
  });
}

const signEvm = (unsignedTransaction: string, sessionPolicyId?: string) =>
  kp.signTransaction({
    subOrgId,
    walletId: evm.walletId,
    chainFamily: 'evm',
    unsignedTransaction,
    ...(sessionPolicyId ? { sessionPolicyId } : {}),
  });

const signSol = (unsignedTransaction: string, sessionPolicyId?: string) =>
  kp.signTransaction({
    subOrgId,
    walletId: sol.walletId,
    chainFamily: 'solana',
    unsignedTransaction,
    ...(sessionPolicyId ? { sessionPolicyId } : {}),
  });

interface Ix {
  program: string;
  accounts: number[];
  data: Uint8Array;
}

function transfer(lamports: bigint): Ix {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return { program: SYSTEM_PROGRAM_ID, accounts: [0, 1], data };
}

const computePrice: Ix = {
  program: COMPUTE_BUDGET_PROGRAM_ID,
  accounts: [],
  data: Uint8Array.from([3, 1, 0, 0, 0, 0, 0, 0, 0]),
};

/**
 * Legacy transaction built by hand. Keys: signers, a recipient, then every program
 * (readonly unsigned). `signers[0]` pays. `prefilled` fills signature slots by index.
 */
function solTx(signers: string[], instructions: Ix[], prefilled = new Map<number, Uint8Array>()) {
  const programs = [...new Set(instructions.map((ix) => ix.program))];
  const recipient = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const keys = [
    ...signers.map((s) => base58.decode(s)),
    recipient,
    ...programs.map((p) => base58.decode(p)),
  ];
  const recipientIndex = signers.length;
  const message = [signers.length, 0, programs.length, keys.length, ...keys.flatMap((k) => [...k])];
  message.push(...new Uint8Array(32).fill(7));
  message.push(instructions.length);
  for (const ix of instructions) {
    const accounts = ix.program === SYSTEM_PROGRAM_ID ? [0, recipientIndex] : ix.accounts;
    message.push(keys.length - programs.length + programs.indexOf(ix.program));
    message.push(accounts.length, ...accounts, ix.data.length, ...ix.data);
  }
  const signatures = new Uint8Array(64 * signers.length);
  for (const [index, bytes] of prefilled) signatures.set(bytes, index * 64);
  return base64.encode(Uint8Array.from([signers.length, ...signatures, ...message]));
}

function signatureSlot(tx: string, index: number): Uint8Array {
  const bytes = base64.decode(tx);
  return bytes.slice(1 + index * 64, 1 + (index + 1) * 64);
}

function messageBytes(tx: string, signerCount: number): Uint8Array {
  return base64.decode(tx).slice(1 + signerCount * 64);
}

describe('MockKeyProvider.signTransaction (EVM)', () => {
  it('signs an unsigned EIP-1559 transaction recoverable to the wallet', async () => {
    const { signedTransaction } = await signEvm(evmTx({ value: 42n }));
    const parsed = parseTransaction(signedTransaction as Hex);
    expect(parsed.value).toBe(42n);
    expect(
      await recoverTransactionAddress({ serializedTransaction: signedTransaction as never }),
    ).toBe(evm.address);
  });

  it('signs under a policy that allows the transaction', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      allowedChains: [8453],
      allowedContracts: [WETH.toLowerCase() as never],
      maxValuePerTx: '100',
    });
    const { signedTransaction } = await signEvm(evmTx({ value: 100n }), policyId);
    expect(
      await recoverTransactionAddress({ serializedTransaction: signedTransaction as never }),
    ).toBe(evm.address);
  });

  it('refuses a chain outside allowedChains', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      allowedChains: [84532],
    });
    await expect(signEvm(evmTx({ chainId: 8453 }), policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('chain 8453') as string,
    });
  });

  it('refuses a destination outside allowedContracts, case-insensitively', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      allowedContracts: ['0x4200000000000000000000000000000000000042' as never],
    });
    await expect(signEvm(evmTx(), policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('contract') as string,
    });
    await expect(
      signEvm(evmTx({ to: getAddress('0x4200000000000000000000000000000000000042') }), policyId),
    ).resolves.toBeDefined();
  });

  it('refuses contract creation when an allowlist exists', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      allowedContracts: [WETH as never],
    });
    const deploy = serializeTransaction({
      type: 'eip1559',
      chainId: 8453,
      data: '0x6000',
      nonce: 0,
      gas: 100_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    await expect(signEvm(deploy, policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('contract creation') as string,
    });
  });

  it('refuses a value above maxValuePerTx and does not enforce maxValueTotal', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      maxValuePerTx: '10',
      maxValueTotal: '10',
    });
    await expect(signEvm(evmTx({ value: 11n }), policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('maxValuePerTx') as string,
    });
    // Stateless like Turnkey: the running total is the API's job.
    await expect(signEvm(evmTx({ value: 10n }), policyId)).resolves.toBeDefined();
    await expect(signEvm(evmTx({ value: 10n }), policyId)).resolves.toBeDefined();
  });

  it('refuses signed, malformed or wrong-curve input', async () => {
    const { signedTransaction } = await signEvm(evmTx());
    await expect(signEvm(signedTransaction)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(signEvm('0xnothex')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(signEvm('0x02c0')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      kp.signTransaction({
        subOrgId,
        walletId: sol.walletId,
        chainFamily: 'evm',
        unsignedTransaction: evmTx(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a Solana policy on an EVM wallet at creation', async () => {
    await expect(
      kp.createPolicy({
        subOrgId,
        walletId: evm.walletId,
        policy: { chain: 'solana', expiresIn: '1h' },
        expiresAt: inOneHour(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('MockKeyProvider.signTransaction (Solana)', () => {
  it('signs its slot, keeps other signatures, and verifies with ed25519', async () => {
    const coSigner = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const existing = new Uint8Array(64).fill(9);
    const tx = solTx([coSigner, sol.address], [transfer(1n)], new Map([[0, existing]]));
    const { signedTransaction } = await signSol(tx);

    expect(signatureSlot(signedTransaction, 0)).toEqual(existing);
    const signature = signatureSlot(signedTransaction, 1);
    expect(
      ed25519.verify(signature, messageBytes(signedTransaction, 2), base58.decode(sol.address)),
    ).toBe(true);
  });

  it('refuses a program outside allowedPrograms but always allows ComputeBudget', async () => {
    const policyId = await policyFor(sol.walletId, {
      chain: 'solana',
      expiresIn: '1h',
      allowedPrograms: [SYSTEM_PROGRAM_ID as never],
    });
    const ok = solTx([sol.address], [computePrice, transfer(5n)]);
    await expect(signSol(ok, policyId)).resolves.toBeDefined();

    const other: Ix = { program: OTHER_PROGRAM, accounts: [0], data: Uint8Array.from([1]) };
    await expect(
      signSol(solTx([sol.address], [transfer(5n), other]), policyId),
    ).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining(OTHER_PROGRAM) as string,
    });
  });

  it('refuses System transfers from the wallet above maxValuePerTx', async () => {
    const policyId = await policyFor(sol.walletId, {
      chain: 'solana',
      expiresIn: '1h',
      maxValuePerTx: '1000',
    });
    await expect(signSol(solTx([sol.address], [transfer(600n)]), policyId)).resolves.toBeDefined();
    await expect(
      signSol(solTx([sol.address], [transfer(600n), transfer(600n)]), policyId),
    ).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('maxValuePerTx') as string,
    });
  });

  it('refuses a transaction the wallet does not sign, and malformed input', async () => {
    const stranger = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    await expect(signSol(solTx([stranger], [transfer(1n)]))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(signSol('not base64!')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses an EVM policy used on a Solana transaction', async () => {
    const evmPolicy = await policyFor(evm.walletId, { chain: 'evm', expiresIn: '1h' });
    // Attached to the EVM wallet, so it is refused before the chain check.
    await expect(signSol(solTx([sol.address], [transfer(1n)]), evmPolicy)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('another wallet') as string,
    });
  });
});

describe('MockKeyProvider session policy lifecycle', () => {
  it('refuses an unknown policy', async () => {
    await expect(signEvm(evmTx(), 'mockpol_0000000000000000')).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('not found') as string,
    });
  });

  it('refuses a policy attached to another wallet', async () => {
    const other = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
    const policyId = await policyFor(other.walletId, { chain: 'evm', expiresIn: '1h' });
    await expect(signEvm(evmTx(), policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('another wallet') as string,
    });
  });

  it('refuses raw payloads when the policy does not allow messages', async () => {
    const policyId = await policyFor(evm.walletId, { chain: 'evm', expiresIn: '1h' });
    await expect(
      kp.signRaw({
        subOrgId,
        walletId: evm.walletId,
        payload: keccak_256(new TextEncoder().encode('gm')),
        encoding: 'hash',
        sessionPolicyId: policyId,
      }),
    ).rejects.toMatchObject({ code: 'policy_denied' });
  });

  it('refuses transactions and raw payloads once the policy expired', async () => {
    const policyId = await policyFor(evm.walletId, {
      chain: 'evm',
      expiresIn: '1h',
      allowMessages: true,
    });
    const digest = keccak_256(new TextEncoder().encode('gm'));
    const raw = () =>
      kp.signRaw({
        subOrgId,
        walletId: evm.walletId,
        payload: digest,
        encoding: 'hash',
        sessionPolicyId: policyId,
      });
    await expect(raw()).resolves.toBeDefined();

    clock = new Date(clock.getTime() + HOUR);
    await expect(signEvm(evmTx(), policyId)).rejects.toMatchObject({
      code: 'policy_denied',
      message: expect.stringContaining('expired') as string,
    });
    await expect(raw()).rejects.toMatchObject({ code: 'policy_denied' });
  });

  it('refuses raw payloads after the policy is deleted', async () => {
    const policyId = await policyFor(sol.walletId, {
      chain: 'solana',
      expiresIn: '1h',
      allowMessages: true,
    });
    const sign = () =>
      kp.signRaw({
        subOrgId,
        walletId: sol.walletId,
        payload: new Uint8Array([1, 2, 3]),
        encoding: 'raw',
        sessionPolicyId: policyId,
      });
    const { signature } = await sign();
    expect(ed25519.verify(signature, new Uint8Array([1, 2, 3]), base58.decode(sol.address))).toBe(
      true,
    );
    await kp.deletePolicy({ subOrgId, policyId });
    await expect(sign()).rejects.toMatchObject({ code: 'policy_denied' });
  });

  it('refuses a policy for a wallet that does not exist', async () => {
    await expect(
      kp.createPolicy({
        subOrgId,
        walletId: 'mockwlt_secp256k1_0000000000000000',
        policy: { chain: 'evm', expiresIn: '1h' },
        expiresAt: inOneHour(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps policies in memory only in seeded mode', async () => {
    const before = createMockKeyProvider({ seed: 'local-dev-seed' });
    const org = await before.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await before.createWallet({ subOrgId: org.subOrgId, curve: 'secp256k1' });
    const { policyId } = await before.createPolicy({
      subOrgId: org.subOrgId,
      walletId: wallet.walletId,
      policy: { chain: 'evm', expiresIn: '1h' },
      expiresAt: new Date(Date.now() + HOUR),
    });
    const input = {
      subOrgId: org.subOrgId,
      walletId: wallet.walletId,
      chainFamily: 'evm' as const,
      unsignedTransaction: evmTx(),
      sessionPolicyId: policyId,
    };
    await expect(before.signTransaction(input)).resolves.toBeDefined();

    const after = createMockKeyProvider({ seed: 'local-dev-seed' });
    await expect(after.signTransaction(input)).rejects.toMatchObject({ code: 'policy_denied' });
  });
});
