import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import {
  AddressLookupTableAccount,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  SolanaTransactionError,
  createSolanaRpc,
  decodeTransaction,
  signTransaction,
} from './index.js';
import { decodeShortVec, encodeShortVec } from './wire.js';

// Throwaway test keys. Never used outside this file.
const payer = Keypair.generate();
const other = Keypair.generate();
const blockhash = base58.encode(new Uint8Array(32).fill(3));
const toB64 = (bytes: Uint8Array) => base64.encode(Uint8Array.from(bytes));

describe('shortvec', () => {
  it.each([
    [0, 1],
    [127, 1],
    [128, 2],
    [16383, 2],
    [16384, 3],
    [65535, 3],
  ])('round trips %i in %i bytes', (value, size) => {
    const encoded = encodeShortVec(value);
    expect(encoded).toHaveLength(size);
    expect(decodeShortVec(encoded)).toEqual({ value, size });
    // Decodes at an offset too.
    expect(decodeShortVec(Uint8Array.from([9, ...encoded]), 1)).toEqual({ value, size });
  });

  it('rejects out of range, truncated and non-canonical encodings', () => {
    expect(() => encodeShortVec(65536)).toThrow(SolanaTransactionError);
    expect(() => encodeShortVec(-1)).toThrow(SolanaTransactionError);
    expect(() => decodeShortVec(Uint8Array.from([0x80]))).toThrow(SolanaTransactionError);
    expect(() => decodeShortVec(Uint8Array.from([0x80, 0x00]))).toThrow(SolanaTransactionError);
    expect(() => decodeShortVec(Uint8Array.from([0xff, 0xff, 0x04]))).toThrow(
      SolanaTransactionError,
    );
  });
});

describe('wire codec against web3.js', () => {
  it('decodes a legacy transaction with 2 instructions like web3.js', async () => {
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight: 1 })
      .add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 10,
        }),
      )
      .add(
        new TransactionInstruction({
          programId: Keypair.generate().publicKey,
          keys: [
            { pubkey: other.publicKey, isSigner: true, isWritable: false },
            { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
          ],
          data: new TextEncoder().encode('memo data') as TransactionInstruction['data'],
        }),
      );
    expect(tx.instructions).toHaveLength(2);
    const serialized = Uint8Array.from(tx.serialize({ requireAllSignatures: false }));

    const decoded = decodeTransaction(toB64(serialized));
    const reference = Transaction.from(serialized);
    expect(decoded.version).toBe('legacy');
    expect(decoded.recentBlockhash).toBe(reference.recentBlockhash);
    expect(decoded.messageBytes).toEqual(Uint8Array.from(reference.serializeMessage()));
    expect(decoded.requiredSigners).toEqual(
      reference.signatures.map((s) => s.publicKey.toBase58()),
    );
    expect(decoded.requiredSigners).toEqual([
      payer.publicKey.toBase58(),
      other.publicKey.toBase58(),
    ]);

    const signed = await signTransaction(toB64(serialized), {
      publicKey: other.publicKey.toBase58(),
      signBytes: async (bytes) => ed25519.sign(bytes, other.secretKey.slice(0, 32)),
    });
    expect(Transaction.from(base64.decode(signed)).verifySignatures(false)).toBe(true);
  });

  it('decodes a v0 transaction with an address table lookup like web3.js', async () => {
    const tableAddresses = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const [firstAddress, secondAddress] = tableAddresses;
    if (!firstAddress || !secondAddress) throw new Error('fixture');
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: payer.publicKey,
        addresses: tableAddresses,
      },
    });
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: firstAddress,
          lamports: 1,
        }),
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: [{ pubkey: secondAddress, isSigner: false, isWritable: false }],
          data: Uint8Array.from([1, 2, 3]) as TransactionInstruction['data'],
        }),
      ],
    }).compileToV0Message([table]);
    expect(message.addressTableLookups).toHaveLength(1);

    const unsigned = new VersionedTransaction(message).serialize();
    const decoded = decodeTransaction(toB64(unsigned));
    const reference = VersionedTransaction.deserialize(unsigned);
    expect(decoded.version).toBe(0);
    expect(decoded.recentBlockhash).toBe(reference.message.recentBlockhash);
    expect(decoded.messageBytes).toEqual(reference.message.serialize());
    expect(decoded.requiredSigners).toEqual([payer.publicKey.toBase58()]);

    const signed = await signTransaction(toB64(unsigned), {
      publicKey: payer.publicKey.toBase58(),
      signBytes: async (bytes) => ed25519.sign(bytes, payer.secretKey.slice(0, 32)),
    });
    const expected = VersionedTransaction.deserialize(unsigned);
    expected.sign([payer]);
    expect(signed).toBe(toB64(expected.serialize()));
  });

  it('rejects version 1 messages and the v1 transaction layout', () => {
    const v0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: other.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const bytes = new VersionedTransaction(v0).serialize();
    const messageOffset = 1 + 64;
    expect(bytes[messageOffset]).toBe(0x80);

    const v1Message = bytes.slice();
    v1Message[messageOffset] = 0x81;
    expect(() => decodeTransaction(toB64(v1Message))).toThrow(/version 1/);

    const v1Layout = Uint8Array.from([0x81, ...bytes.slice(1)]);
    expect(() => decodeTransaction(toB64(v1Layout))).toThrow(SolanaTransactionError);
  });

  it('rejects trailing bytes and mismatched signature counts', () => {
    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash,
      lastValidBlockHeight: 1,
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: other.publicKey,
        lamports: 1,
      }),
    );
    const bytes = Uint8Array.from(tx.serialize({ requireAllSignatures: false }));
    expect(() => decodeTransaction(toB64(Uint8Array.from([...bytes, 0])))).toThrow(
      /trailing bytes/,
    );
    // Two signature slots for a message that requires one.
    const extraSlot = Uint8Array.from([2, ...new Uint8Array(64), ...bytes.slice(1)]);
    expect(() => decodeTransaction(toB64(extraSlot))).toThrow(SolanaTransactionError);
    // Truncated message.
    expect(() => decodeTransaction(toB64(bytes.slice(0, bytes.length - 1)))).toThrow(
      SolanaTransactionError,
    );
  });
});

describe('createSolanaRpc', () => {
  function fakeFetch(responses: unknown[]) {
    const requests: { url: string; body: unknown }[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') });
      return new Response(JSON.stringify(responses.shift()), {
        headers: { 'content-type': 'application/json' },
      });
    };
    return { impl, requests };
  }

  it('sends the expected JSON-RPC payloads to the default cluster URL', async () => {
    const { impl, requests } = fakeFetch([
      {
        jsonrpc: '2.0',
        id: 1,
        result: { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 99 } },
      },
      { jsonrpc: '2.0', id: 2, result: 'sig123' },
    ]);
    const rpc = createSolanaRpc({ cluster: 'devnet', fetch: impl });

    expect(await rpc.getLatestBlockhash()).toEqual({ blockhash, lastValidBlockHeight: 99 });
    const raw = Uint8Array.from([1, 2, 3, 4]);
    expect(await rpc.sendRawTransaction(raw)).toBe('sig123');

    expect(requests).toEqual([
      {
        url: 'https://api.devnet.solana.com',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestBlockhash',
          params: [{ commitment: 'confirmed' }],
        },
      },
      {
        url: 'https://api.devnet.solana.com',
        body: {
          jsonrpc: '2.0',
          id: 2,
          method: 'sendTransaction',
          params: [base64.encode(raw), { encoding: 'base64', preflightCommitment: 'confirmed' }],
        },
      },
    ]);
  });

  it('uses the custom URL and the mainnet default', async () => {
    const custom = fakeFetch([{ jsonrpc: '2.0', id: 1, result: 'x' }]);
    await createSolanaRpc({
      cluster: 'mainnet-beta',
      url: 'https://rpc.example',
      fetch: custom.impl,
    }).sendRawTransaction(new Uint8Array(1));
    expect(custom.requests[0]?.url).toBe('https://rpc.example');

    const main = fakeFetch([{ jsonrpc: '2.0', id: 1, result: 'x' }]);
    await createSolanaRpc({ cluster: 'mainnet-beta', fetch: main.impl }).sendRawTransaction(
      new Uint8Array(1),
    );
    expect(main.requests[0]?.url).toBe('https://api.mainnet-beta.solana.com');
  });

  it('throws SolanaTransactionError with the RPC error message', async () => {
    const { impl } = fakeFetch([
      { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Blockhash not found' } },
      { jsonrpc: '2.0', id: 2, result: { value: { blockhash: 42 } } },
    ]);
    const rpc = createSolanaRpc({ cluster: 'devnet', fetch: impl });
    const failure = rpc.sendRawTransaction(new Uint8Array(1));
    await expect(failure).rejects.toThrow(SolanaTransactionError);
    await expect(failure).rejects.toThrow('Blockhash not found');
    await expect(rpc.getLatestBlockhash()).rejects.toThrow(SolanaTransactionError);
  });
});
