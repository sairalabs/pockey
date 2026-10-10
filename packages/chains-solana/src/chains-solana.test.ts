import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import {
  Keypair,
  type PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  SolanaTransactionError,
  buildSiwsMessage,
  decodeTransaction,
  signMessage,
  signTransaction,
  transactionId,
  verifySiwsLogin,
  type SignBytes,
} from './index.js';

// Throwaway test keys. Never used outside this file.
const payer = Keypair.generate();
const other = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const blockhash = base58.encode(new Uint8Array(32).fill(7));

const signBytesFor =
  (keypair: Keypair): SignBytes =>
  async (bytes) =>
    ed25519.sign(bytes, keypair.secretKey.slice(0, 32));

const signerFor = (keypair: Keypair) => ({
  publicKey: keypair.publicKey.toBase58(),
  signBytes: signBytesFor(keypair),
});

function transfer(from: PublicKey, lamports = 1000) {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: recipient, lamports });
}

function legacyTx(feePayer = payer.publicKey, extraFrom?: PublicKey): Transaction {
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight: 1 }).add(
    transfer(feePayer),
  );
  if (extraFrom) tx.add(transfer(extraFrom, 2000));
  return tx;
}

function v0Tx(feePayer = payer.publicKey, extraFrom?: PublicKey): VersionedTransaction {
  const instructions = [transfer(feePayer)];
  if (extraFrom) instructions.push(transfer(extraFrom, 2000));
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

const toB64 = (bytes: Uint8Array) => base64.encode(Uint8Array.from(bytes));

describe('decodeTransaction', () => {
  it('decodes a legacy transaction', () => {
    const tx = legacyTx();
    const decoded = decodeTransaction(toB64(tx.serialize({ requireAllSignatures: false })));
    expect(decoded.version).toBe('legacy');
    expect(decoded.requiredSigners).toEqual([payer.publicKey.toBase58()]);
    expect(decoded.recentBlockhash).toBe(blockhash);
    expect(decoded.messageBytes).toEqual(Uint8Array.from(tx.serializeMessage()));
  });

  it('decodes a v0 transaction', () => {
    const tx = v0Tx(payer.publicKey, other.publicKey);
    const decoded = decodeTransaction(toB64(tx.serialize()));
    expect(decoded.version).toBe(0);
    expect(decoded.requiredSigners).toEqual([
      payer.publicKey.toBase58(),
      other.publicKey.toBase58(),
    ]);
    expect(decoded.messageBytes).toEqual(tx.message.serialize());
  });

  it('throws SolanaTransactionError on garbage', () => {
    for (const input of [
      '',
      'not base64!!',
      'AAAA',
      toB64(new Uint8Array([1, 2, 3])),
      toB64(new Uint8Array(200).fill(9)),
    ]) {
      expect(() => decodeTransaction(input)).toThrow(SolanaTransactionError);
    }
    const valid = legacyTx().serialize({ requireAllSignatures: false });
    const trailing = new Uint8Array([...valid, 1, 2, 3]);
    expect(() => decodeTransaction(toB64(trailing))).toThrow(SolanaTransactionError);
  });
});

describe('signTransaction', () => {
  it('signs a legacy transaction exactly like Transaction.sign', async () => {
    const tx = legacyTx();
    const unsigned = toB64(tx.serialize({ requireAllSignatures: false }));
    const signed = await signTransaction(unsigned, signerFor(payer));

    const reference = legacyTx();
    reference.sign(payer);
    expect(signed).toBe(toB64(reference.serialize()));

    const roundTrip = Transaction.from(base64.decode(signed));
    expect(roundTrip.verifySignatures()).toBe(true);
  });

  it('signs a v0 transaction exactly like VersionedTransaction.sign', async () => {
    const tx = v0Tx();
    const signed = await signTransaction(toB64(tx.serialize()), signerFor(payer));

    const reference = v0Tx();
    reference.sign([payer]);
    expect(signed).toBe(toB64(reference.serialize()));

    const roundTrip = VersionedTransaction.deserialize(base64.decode(signed));
    const signature = roundTrip.signatures[0] ?? new Uint8Array();
    expect(
      ed25519.verify(signature, roundTrip.message.serialize(), payer.publicKey.toBytes()),
    ).toBe(true);
  });

  it('supports partial signing with two required signers (legacy)', async () => {
    const unsigned = toB64(
      legacyTx(payer.publicKey, other.publicKey).serialize({ requireAllSignatures: false }),
    );
    const once = await signTransaction(unsigned, signerFor(other));
    expect(Transaction.from(base64.decode(once)).verifySignatures(false)).toBe(true);
    expect(Transaction.from(base64.decode(once)).verifySignatures(true)).toBe(false);

    const twice = await signTransaction(once, signerFor(payer));
    const tx = Transaction.from(base64.decode(twice));
    expect(tx.verifySignatures(true)).toBe(true);
    expect(tx.signatures.map((s) => s.publicKey.toBase58())).toEqual([
      payer.publicKey.toBase58(),
      other.publicKey.toBase58(),
    ]);

    const reference = legacyTx(payer.publicKey, other.publicKey);
    reference.sign(payer, other);
    expect(twice).toBe(toB64(reference.serialize()));
  });

  it('supports partial signing with two required signers (v0)', async () => {
    const unsigned = toB64(v0Tx(payer.publicKey, other.publicKey).serialize());
    const once = await signTransaction(unsigned, signerFor(payer));
    const twice = await signTransaction(once, signerFor(other));

    const tx = VersionedTransaction.deserialize(base64.decode(twice));
    const message = tx.message.serialize();
    expect(
      ed25519.verify(tx.signatures[0] ?? new Uint8Array(), message, payer.publicKey.toBytes()),
    ).toBe(true);
    expect(
      ed25519.verify(tx.signatures[1] ?? new Uint8Array(), message, other.publicKey.toBytes()),
    ).toBe(true);

    const reference = v0Tx(payer.publicKey, other.publicKey);
    reference.sign([payer, other]);
    expect(twice).toBe(toB64(reference.serialize()));
  });

  it('throws when the key is not a required signer', async () => {
    const unsigned = toB64(legacyTx().serialize({ requireAllSignatures: false }));
    await expect(signTransaction(unsigned, signerFor(other))).rejects.toThrow(
      SolanaTransactionError,
    );
  });

  it('throws when the signer returns a bad signature', async () => {
    const unsigned = toB64(legacyTx().serialize({ requireAllSignatures: false }));
    const publicKey = payer.publicKey.toBase58();
    await expect(
      signTransaction(unsigned, { publicKey, signBytes: async () => new Uint8Array(63) }),
    ).rejects.toThrow(SolanaTransactionError);
    await expect(
      signTransaction(unsigned, { publicKey, signBytes: signBytesFor(other) }),
    ).rejects.toThrow(SolanaTransactionError);
  });
});

describe('transactionId', () => {
  it('is the base58 of the first signature', async () => {
    const signed = await signTransaction(toB64(v0Tx().serialize()), signerFor(payer));
    const tx = VersionedTransaction.deserialize(base64.decode(signed));
    expect(transactionId(signed)).toBe(base58.encode(tx.signatures[0] ?? new Uint8Array()));
  });

  it('throws on an unsigned transaction', () => {
    expect(() => transactionId(toB64(v0Tx().serialize()))).toThrow(SolanaTransactionError);
  });
});

describe('signMessage', () => {
  it('returns a base64 signature that verifies', async () => {
    const bytes = new TextEncoder().encode('hello pockey');
    const signature = await signMessage(base64.encode(bytes), signBytesFor(payer));
    expect(ed25519.verify(base64.decode(signature), bytes, payer.publicKey.toBytes())).toBe(true);
  });

  it('rejects invalid base64', async () => {
    await expect(signMessage('%%%', signBytesFor(payer))).rejects.toThrow(SolanaTransactionError);
  });
});

describe('SIWS', () => {
  const domain = 'app.example.com';
  const nonce = 'abc123XYZ789';
  const now = new Date('2026-09-16T12:00:00.000Z');
  const address = payer.publicKey.toBase58();

  function build(overrides: { expirationTime?: Date; address?: string } = {}) {
    return buildSiwsMessage({
      domain,
      address,
      nonce,
      statement: 'Sign in to Example',
      uri: 'https://app.example.com',
      issuedAt: new Date('2026-09-16T11:59:00.000Z'),
      chainId: 'mainnet',
      ...overrides,
    });
  }

  function sign(message: string, keypair = payer) {
    return base64.encode(
      ed25519.sign(new TextEncoder().encode(message), keypair.secretKey.slice(0, 32)),
    );
  }

  it('builds the standard layout', () => {
    expect(build()).toBe(
      [
        `${domain} wants you to sign in with your Solana account:`,
        address,
        '',
        'Sign in to Example',
        '',
        'URI: https://app.example.com',
        'Version: 1',
        'Chain ID: mainnet',
        `Nonce: ${nonce}`,
        'Issued At: 2026-09-16T11:59:00.000Z',
      ].join('\n'),
    );
  });

  it('accepts a valid login, with and without statement', () => {
    const message = build({ expirationTime: new Date('2026-09-16T12:05:00.000Z') });
    const base = { signature: sign(message), publicKey: address, expectedNonce: nonce, now };
    expect(verifySiwsLogin({ ...base, message, expectedDomain: domain })).toEqual({ address });

    const minimal = buildSiwsMessage({ domain, address, nonce });
    expect(
      verifySiwsLogin({
        message: minimal,
        signature: sign(minimal),
        publicKey: address,
        expectedNonce: nonce,
      }),
    ).toEqual({ address });
  });

  it('rejects a wrong nonce', () => {
    const message = build();
    const signature = sign(message);
    expect(
      verifySiwsLogin({ message, signature, publicKey: address, expectedNonce: 'other123', now }),
    ).toBeNull();
    expect(
      verifySiwsLogin({ message, signature, publicKey: address, expectedNonce: '', now }),
    ).toBeNull();
  });

  it('rejects a wrong domain', () => {
    const message = build();
    expect(
      verifySiwsLogin({
        message,
        signature: sign(message),
        publicKey: address,
        expectedNonce: nonce,
        expectedDomain: 'evil.com',
        now,
      }),
    ).toBeNull();
  });

  it('rejects an expired message', () => {
    const message = build({ expirationTime: new Date('2026-09-16T11:59:30.000Z') });
    expect(
      verifySiwsLogin({
        message,
        signature: sign(message),
        publicKey: address,
        expectedNonce: nonce,
        now,
      }),
    ).toBeNull();
  });

  it('rejects a wrong key', () => {
    const message = build();
    // Signed by another key but claiming the payer address.
    expect(
      verifySiwsLogin({
        message,
        signature: sign(message, other),
        publicKey: address,
        expectedNonce: nonce,
        now,
      }),
    ).toBeNull();
    // Valid signature, but the address line does not match the provided key.
    expect(
      verifySiwsLogin({
        message,
        signature: sign(message),
        publicKey: other.publicKey.toBase58(),
        expectedNonce: nonce,
        now,
      }),
    ).toBeNull();
  });

  it('rejects a tampered message', () => {
    const message = build();
    const signature = sign(message);
    const tampered = message.replace('Sign in to Example', 'Sign in to Exampl3');
    expect(
      verifySiwsLogin({
        message: tampered,
        signature,
        publicKey: address,
        expectedNonce: nonce,
        now,
      }),
    ).toBeNull();
  });

  it('handles garbage without throwing', () => {
    const message = build();
    const base = { publicKey: address, expectedNonce: nonce, now };
    for (const signature of ['', '%%%', 'AAAA', base64.encode(new Uint8Array(64))]) {
      expect(verifySiwsLogin({ ...base, message, signature })).toBeNull();
    }
    expect(verifySiwsLogin({ ...base, message: 'garbage', signature: sign('garbage') })).toBeNull();
    expect(
      verifySiwsLogin({
        message,
        signature: sign(message),
        publicKey: 'not-base58-0OIl',
        expectedNonce: nonce,
        now,
      }),
    ).toBeNull();
  });
});
