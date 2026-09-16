import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { SolanaTransactionError } from './errors.js';
import {
  PUBLIC_KEY_LENGTH,
  SIGNATURE_LENGTH,
  parseTransaction,
  type ParsedTransaction,
} from './wire.js';

/**
 * Signs raw bytes with ed25519 and returns the 64-byte signature. Implemented
 * by the caller (the API wires it to `KeyProvider.signRaw`).
 */
export type SignBytes = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface DecodedTransaction {
  version: 'legacy' | 0;
  /** Exact message bytes covered by every signature. */
  messageBytes: Uint8Array;
  /** Base58 public keys that must sign, in signature order. */
  requiredSigners: string[];
  recentBlockhash: string;
}

function decodeBase64(value: string, what: string): Uint8Array {
  try {
    return base64.decode(value);
  } catch (cause) {
    throw new SolanaTransactionError(`${what} is not valid base64`, { cause });
  }
}

function parseBase64Transaction(base64Tx: string): ParsedTransaction {
  return parseTransaction(decodeBase64(base64Tx, 'Transaction'));
}

/**
 * Decodes a base64 legacy or v0 transaction, signed, partially signed or unsigned.
 * Throws `SolanaTransactionError` on anything else.
 */
export function decodeTransaction(base64Tx: string): DecodedTransaction {
  const { version, messageBytes, requiredSigners, recentBlockhash } =
    parseBase64Transaction(base64Tx);
  return { version, messageBytes, requiredSigners, recentBlockhash };
}

async function signChecked(
  bytes: Uint8Array,
  publicKey: Uint8Array | undefined,
  signBytes: SignBytes,
): Promise<Uint8Array> {
  const signature = await signBytes(bytes);
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) {
    throw new SolanaTransactionError('Signer returned a signature that is not 64 bytes');
  }
  if (publicKey && !ed25519.verify(signature, bytes, publicKey)) {
    throw new SolanaTransactionError('Signer returned a signature that does not verify');
  }
  return signature;
}

function decodePublicKey(publicKey: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(publicKey);
  } catch (cause) {
    throw new SolanaTransactionError('Public key is not valid base58', { cause });
  }
  if (bytes.length !== PUBLIC_KEY_LENGTH) {
    throw new SolanaTransactionError('Public key must be 32 bytes');
  }
  return bytes;
}

/**
 * Signs the transaction message for `signer.publicKey` and writes the signature
 * into that signer's slot. Every other slot is kept byte for byte, so partially
 * signed transactions (fee payer co-sign) round-trip. Returns base64.
 */
export async function signTransaction(
  base64Tx: string,
  signer: { publicKey: string; signBytes: SignBytes },
): Promise<string> {
  const tx = parseBase64Transaction(base64Tx);
  const index = tx.requiredSigners.indexOf(signer.publicKey);
  if (index < 0) {
    throw new SolanaTransactionError(
      `${signer.publicKey} is not a required signer of this transaction`,
    );
  }
  const publicKey = decodePublicKey(signer.publicKey);
  const signature = await signChecked(tx.messageBytes, publicKey, signer.signBytes);

  const out = tx.bytes.slice();
  out.set(signature, tx.signaturesOffset + index * SIGNATURE_LENGTH);
  return base64.encode(out);
}

/** Signs arbitrary base64 bytes and returns the base64 signature. */
export async function signMessage(base64Message: string, signBytes: SignBytes): Promise<string> {
  const bytes = decodeBase64(base64Message, 'Message');
  return base64.encode(await signChecked(bytes, undefined, signBytes));
}

/** Transaction id: base58 of the first signature. Throws if that slot is empty. */
export function transactionId(base64Signed: string): string {
  const tx = parseBase64Transaction(base64Signed);
  const first = tx.bytes.slice(tx.signaturesOffset, tx.signaturesOffset + SIGNATURE_LENGTH);
  if (tx.signatureCount === 0 || first.every((byte) => byte === 0)) {
    throw new SolanaTransactionError('Transaction has no first signature');
  }
  return base58.encode(first);
}
