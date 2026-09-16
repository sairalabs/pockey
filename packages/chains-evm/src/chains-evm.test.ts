import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes, recoverTransactionAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateSiweNonce } from 'viem/siwe';
import type { EvmTransactionRequest, SignTypedDataInput } from '@pocketkey/types';
import {
  EVM_VIEM_CHAINS,
  buildSiweMessage,
  hashPersonalMessage,
  hashTypedDataInput,
  normalizeSignature,
  prepareTransaction,
  serializeSignedTransaction,
  signPersonalMessage,
  signTransaction,
  signTypedDataInput,
  signatureToHex,
  toPocketkeyAccount,
  transactionSigningHash,
  verifySiweLogin,
  type EvmRpc,
  type PreparedEvmTransaction,
  type SignHash,
} from './index.js';

// Throwaway test key. Never used outside this file.
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

/** Mirrors packages/key-provider/src/mock: noble recovered format, recovery byte moved last. */
const signHash: SignHash = async (hash) => {
  const sig = secp256k1.sign(hexToBytes(hash), hexToBytes(privateKey), {
    prehash: false,
    format: 'recovered',
  });
  const out = new Uint8Array(65);
  out.set(sig.slice(1), 0);
  out[64] = 27 + (sig[0] ?? 0);
  return signatureToHex(out);
};

const permit = {
  chain: 'evm',
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  message: {
    owner: account.address,
    spender: '0x1111111254EEB25477B68fb85Ed929f73A960582',
    value: '1000000',
    nonce: '0',
    deadline: '1900000000',
  },
} as unknown as SignTypedDataInput;

const tx: PreparedEvmTransaction = {
  chainId: 8453,
  to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
  value: 123_456_789n,
  data: '0xdeadbeef',
  nonce: 7,
  gas: 21_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000n,
};

describe('chains', () => {
  it('maps every supported chainId to the matching viem chain', () => {
    for (const [id, chain] of Object.entries(EVM_VIEM_CHAINS)) {
      expect(chain.id).toBe(Number(id));
    }
    expect(Object.keys(EVM_VIEM_CHAINS)).toHaveLength(6);
  });
});

describe('signatureToHex / normalizeSignature', () => {
  it('encodes 65 bytes and throws on 64', () => {
    expect(signatureToHex(new Uint8Array(65))).toMatch(/^0x[0-9a-f]{130}$/);
    expect(() => signatureToHex(new Uint8Array(64))).toThrow();
  });

  it('normalizes v in {0,1} to {27,28} and rejects bad input', () => {
    const bytes = new Uint8Array(65);
    bytes[64] = 1;
    expect(normalizeSignature(bytesToHex(bytes)).endsWith('1c')).toBe(true);
    bytes[64] = 5;
    expect(() => normalizeSignature(bytesToHex(bytes))).toThrow();
    expect(() => normalizeSignature('0x1234')).toThrow();
  });
});

describe('messages', () => {
  it('signs a UTF-8 personal message identically to a viem account', async () => {
    const message = 'Hello Pocketkey';
    const hash = hashPersonalMessage(message);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await signPersonalMessage(message, signHash)).toBe(
      await account.signMessage({ message }),
    );
  });

  it('signs a raw hex personal message identically to a viem account', async () => {
    const message = { raw: '0x00ff10abcdef' as Hex };
    expect(await signPersonalMessage(message, signHash)).toBe(
      await account.signMessage({ message }),
    );
  });

  it('signs EIP-712 typed data identically to a viem account', async () => {
    expect(hashTypedDataInput(permit)).toMatch(/^0x[0-9a-f]{64}$/);
    const expected = await account.signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 8453,
        verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: account.address,
        spender: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        value: 1_000_000n,
        nonce: 0n,
        deadline: 1_900_000_000n,
      },
    });
    expect(await signTypedDataInput(permit, signHash)).toBe(expected);
  });
});

describe('transactions', () => {
  it('signs an EIP-1559 transaction identically to a viem account', async () => {
    const signed = await signTransaction(tx, signHash);
    const expected = await account.signTransaction({ type: 'eip1559', ...tx });
    expect(signed).toBe(expected);
    expect(
      await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` }),
    ).toBe(account.address);
  });

  it('serializeSignedTransaction accepts a detached signature', async () => {
    const signature = await signHash(transactionSigningHash(tx));
    expect(serializeSignedTransaction(tx, signature)).toBe(await signTransaction(tx, signHash));
  });
});

describe('toPocketkeyAccount', () => {
  const pk = toPocketkeyAccount({ address: account.address, signHash });

  it('is a local account with the given address', () => {
    expect(pk.type).toBe('local');
    expect(pk.address).toBe(account.address);
  });

  it('signs messages, typed data and transactions like the viem account', async () => {
    expect(await pk.signMessage({ message: 'gm' })).toBe(
      await account.signMessage({ message: 'gm' }),
    );
    const typed = {
      domain: { name: 'Test', chainId: 1 },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail',
      message: { contents: 'hello' },
    } as const;
    expect(await pk.signTypedData(typed)).toBe(await account.signTypedData(typed));
    const viemTx = { type: 'eip1559', ...tx } as const;
    expect(await pk.signTransaction(viemTx)).toBe(await account.signTransaction(viemTx));
    const hash = transactionSigningHash(tx);
    expect(await pk.sign?.({ hash })).toBe(await account.sign({ hash }));
  });
});

describe('prepareTransaction', () => {
  const from: Address = account.address;

  function mockRpc() {
    const calls = { nonce: 0, gas: 0, fees: 0 };
    const rpc: EvmRpc = {
      async getTransactionCount() {
        calls.nonce++;
        return 42;
      },
      async estimateGas() {
        calls.gas++;
        return 100_000n;
      },
      async estimateFeesPerGas() {
        calls.fees++;
        return { maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 2_000_000n };
      },
      async sendRawTransaction() {
        return '0x';
      },
    };
    return { rpc, calls };
  }

  const baseRequest = {
    chain: 'evm',
    chainId: 8453,
    to: '0x1111111254eeb25477b68fb85ed929f73a960582',
    value: '5',
    data: '0x',
  } as unknown as EvmTransactionRequest;

  it('fills missing fields from rpc and applies a 20% gas buffer', async () => {
    const { rpc, calls } = mockRpc();
    const prepared = await prepareTransaction(baseRequest, from, rpc);
    expect(prepared).toEqual({
      chainId: 8453,
      to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
      value: 5n,
      data: '0x',
      nonce: 42,
      gas: 120_000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 2_000_000n,
    });
    expect(calls).toEqual({ nonce: 1, gas: 1, fees: 1 });
  });

  it('respects overrides and skips the matching rpc calls', async () => {
    const { rpc, calls } = mockRpc();
    const prepared = await prepareTransaction(
      {
        ...baseRequest,
        gas: '50000',
        nonce: 3,
        maxFeePerGas: '10',
        maxPriorityFeePerGas: '1',
      },
      from,
      rpc,
    );
    expect(prepared.gas).toBe(50_000n);
    expect(prepared.nonce).toBe(3);
    expect(prepared.maxFeePerGas).toBe(10n);
    expect(prepared.maxPriorityFeePerGas).toBe(1n);
    expect(calls).toEqual({ nonce: 0, gas: 0, fees: 0 });
  });

  it('raises the estimated max fee when an explicit priority fee exceeds it', async () => {
    const { rpc } = mockRpc();
    const prepared = await prepareTransaction(
      { ...baseRequest, maxPriorityFeePerGas: '5000000000' },
      from,
      rpc,
    );
    expect(prepared.maxFeePerGas).toBe(5_000_000_000n);
  });
});

describe('SIWE', () => {
  const domain = 'app.example.com';
  const nonce = generateSiweNonce();
  const now = new Date('2026-09-16T12:00:00.000Z');

  async function signed(overrides: { expirationTime?: Date } = {}) {
    const message = buildSiweMessage({
      domain,
      uri: 'https://app.example.com/login',
      address: account.address,
      chainId: 8453,
      nonce,
      statement: 'Sign in to Example',
      issuedAt: new Date('2026-09-16T11:59:00.000Z'),
      ...overrides,
    });
    const signature = await account.signMessage({ message });
    return { message, signature };
  }

  it('builds a standard EIP-4361 message', async () => {
    const { message } = await signed();
    expect(message).toContain(`${domain} wants you to sign in with your Ethereum account:`);
    expect(message).toContain(`Nonce: ${nonce}`);
  });

  it('accepts a valid login', async () => {
    const { message, signature } = await signed({
      expirationTime: new Date('2026-09-16T12:10:00.000Z'),
    });
    expect(
      await verifySiweLogin({
        message,
        signature,
        expectedNonce: nonce,
        expectedDomain: domain,
        now,
      }),
    ).toEqual({ address: account.address, chainId: 8453 });
    expect(await verifySiweLogin({ message, signature, expectedNonce: nonce, now })).not.toBeNull();
  });

  it('accepts a login signed through signPersonalMessage', async () => {
    const { message } = await signed();
    const signature = await signPersonalMessage(message, signHash);
    expect(await verifySiweLogin({ message, signature, expectedNonce: nonce, now })).not.toBeNull();
  });

  it('rejects a wrong nonce', async () => {
    const { message, signature } = await signed();
    expect(
      await verifySiweLogin({ message, signature, expectedNonce: 'otherNonce123', now }),
    ).toBeNull();
    expect(await verifySiweLogin({ message, signature, expectedNonce: '', now })).toBeNull();
  });

  it('rejects a wrong domain', async () => {
    const { message, signature } = await signed();
    expect(
      await verifySiweLogin({
        message,
        signature,
        expectedNonce: nonce,
        expectedDomain: 'evil.com',
        now,
      }),
    ).toBeNull();
    expect(
      await verifySiweLogin({ message, signature, expectedNonce: nonce, expectedDomain: '', now }),
    ).toBeNull();
  });

  it('rejects an expired message', async () => {
    const { message, signature } = await signed({
      expirationTime: new Date('2026-09-16T11:59:30.000Z'),
    });
    expect(await verifySiweLogin({ message, signature, expectedNonce: nonce, now })).toBeNull();
  });

  it('rejects a tampered message', async () => {
    const { message, signature } = await signed();
    const tampered = message.replace('Sign in to Example', 'Sign in to Exampl3');
    expect(
      await verifySiweLogin({ message: tampered, signature, expectedNonce: nonce, now }),
    ).toBeNull();
  });

  it('rejects garbage signatures and messages without throwing', async () => {
    const { message } = await signed();
    for (const signature of [
      '0x',
      '0x1234',
      'nothex',
      `0x${'00'.repeat(65)}`,
      `0x${'zz'.repeat(65)}`,
    ]) {
      expect(
        await verifySiweLogin({ message, signature: signature as Hex, expectedNonce: nonce, now }),
      ).toBeNull();
    }
    const { signature } = await signed();
    expect(
      await verifySiweLogin({ message: 'hello', signature, expectedNonce: nonce, now }),
    ).toBeNull();
  });

  it('rejects a signature from another key', async () => {
    const { message } = await signed();
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message });
    expect(await verifySiweLogin({ message, signature, expectedNonce: nonce, now })).toBeNull();
  });
});
