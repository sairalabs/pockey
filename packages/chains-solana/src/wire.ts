import { base58 } from '@scure/base';
import { SolanaTransactionError } from './errors.js';

/**
 * Hand-written Solana wire format codec (legacy and v0 transactions).
 * Kept dependency free so the package runs in Workers and browsers without web3.js.
 */

export const SIGNATURE_LENGTH = 64;
export const PUBLIC_KEY_LENGTH = 32;
const VERSION_PREFIX_BIT = 0x80;
const VERSION_MASK = 0x7f;
const MAX_SHORT_VEC = 0xffff;

/** Encodes a compact-u16 (shortvec) length. */
export function encodeShortVec(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SHORT_VEC) {
    throw new SolanaTransactionError(`shortvec value out of range: ${value}`);
  }
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    out.push(byte | 0x80);
  }
}

/**
 * Decodes a compact-u16 (shortvec) at `offset`. Rejects truncated, oversized and
 * non-canonical encodings, like the Solana runtime does.
 */
export function decodeShortVec(bytes: Uint8Array, offset = 0): { value: number; size: number } {
  let value = 0;
  for (let size = 0; size < 3; size++) {
    const byte = bytes[offset + size];
    if (byte === undefined) throw new SolanaTransactionError('Truncated shortvec');
    const bits = byte & 0x7f;
    if (size === 2 && byte > 0x03) throw new SolanaTransactionError('shortvec overflow');
    value |= bits << (7 * size);
    if ((byte & 0x80) === 0) {
      if (size > 0 && byte === 0) throw new SolanaTransactionError('Non-canonical shortvec');
      return { value, size: size + 1 };
    }
  }
  throw new SolanaTransactionError('shortvec overflow');
}

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  u8(): number {
    const byte = this.bytes[this.offset];
    if (byte === undefined) throw new SolanaTransactionError('Truncated transaction');
    this.offset += 1;
    return byte;
  }

  take(length: number): Uint8Array {
    if (length > this.remaining) throw new SolanaTransactionError('Truncated transaction');
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  skip(length: number): void {
    if (length > this.remaining) throw new SolanaTransactionError('Truncated transaction');
    this.offset += length;
  }

  shortVec(): number {
    const { value, size } = decodeShortVec(this.bytes, this.offset);
    this.offset += size;
    return value;
  }
}

export interface ParsedInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface ParsedAddressTableLookup {
  accountKey: Uint8Array;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface ParsedMessage {
  version: 'legacy' | 0;
  numRequiredSignatures: number;
  numReadonlySigned: number;
  numReadonlyUnsigned: number;
  staticAccountKeys: Uint8Array[];
  recentBlockhash: Uint8Array;
  instructions: ParsedInstruction[];
  addressTableLookups: ParsedAddressTableLookup[];
}

/** Parses a full message. Throws if any byte is left over. */
export function parseMessage(messageBytes: Uint8Array): ParsedMessage {
  const reader = new Reader(messageBytes);
  let version: 'legacy' | 0 = 'legacy';

  const prefix = messageBytes[0];
  if (prefix === undefined) throw new SolanaTransactionError('Empty transaction message');
  if ((prefix & VERSION_PREFIX_BIT) !== 0) {
    const messageVersion = prefix & VERSION_MASK;
    if (messageVersion !== 0) {
      throw new SolanaTransactionError(`Unsupported transaction version ${messageVersion}`);
    }
    version = 0;
    reader.skip(1);
  }

  const numRequiredSignatures = reader.u8();
  const numReadonlySigned = reader.u8();
  const numReadonlyUnsigned = reader.u8();

  const numKeys = reader.shortVec();
  const staticAccountKeys: Uint8Array[] = [];
  for (let i = 0; i < numKeys; i++) staticAccountKeys.push(reader.take(PUBLIC_KEY_LENGTH));

  if (numRequiredSignatures > numKeys) {
    throw new SolanaTransactionError('Message requires more signers than it has keys');
  }
  if (numReadonlySigned > numRequiredSignatures) {
    throw new SolanaTransactionError('Invalid message header');
  }
  if (numReadonlyUnsigned > numKeys - numRequiredSignatures) {
    throw new SolanaTransactionError('Invalid message header');
  }

  const recentBlockhash = reader.take(PUBLIC_KEY_LENGTH);

  const numInstructions = reader.shortVec();
  const instructions: ParsedInstruction[] = [];
  for (let i = 0; i < numInstructions; i++) {
    const programIdIndex = reader.u8();
    const accountIndexes = Array.from(reader.take(reader.shortVec()));
    const data = reader.take(reader.shortVec());
    instructions.push({ programIdIndex, accountIndexes, data });
  }

  const addressTableLookups: ParsedAddressTableLookup[] = [];
  if (version === 0) {
    const numLookups = reader.shortVec();
    for (let i = 0; i < numLookups; i++) {
      const accountKey = reader.take(PUBLIC_KEY_LENGTH);
      const writableIndexes = Array.from(reader.take(reader.shortVec()));
      const readonlyIndexes = Array.from(reader.take(reader.shortVec()));
      addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
    }
  }

  if (reader.remaining !== 0) {
    throw new SolanaTransactionError('Transaction message has trailing bytes');
  }

  return {
    version,
    numRequiredSignatures,
    numReadonlySigned,
    numReadonlyUnsigned,
    staticAccountKeys,
    recentBlockhash,
    instructions,
    addressTableLookups,
  };
}

export interface ParsedTransaction {
  bytes: Uint8Array;
  version: 'legacy' | 0;
  messageBytes: Uint8Array;
  /** Offset of the first signature slot in `bytes`. */
  signaturesOffset: number;
  signatureCount: number;
  requiredSigners: string[];
  recentBlockhash: string;
}

/** Parses `shortvec(numSignatures) || signatures || message`. */
export function parseTransaction(bytes: Uint8Array): ParsedTransaction {
  if (bytes.length === 0) throw new SolanaTransactionError('Empty transaction');
  // A signature count needing a second shortvec byte (128+) cannot fit a packet;
  // a high first byte is the v1 layout (message first) or garbage.
  if (((bytes[0] ?? 0) & VERSION_PREFIX_BIT) !== 0) {
    throw new SolanaTransactionError('Unsupported transaction format');
  }

  const reader = new Reader(bytes);
  const signatureCount = reader.shortVec();
  const signaturesOffset = reader.offset;
  reader.skip(signatureCount * SIGNATURE_LENGTH);
  const messageBytes = bytes.slice(reader.offset);

  const message = parseMessage(messageBytes);
  if (message.numRequiredSignatures !== signatureCount) {
    throw new SolanaTransactionError(
      `Transaction carries ${signatureCount} signature slots but requires ${message.numRequiredSignatures}`,
    );
  }

  return {
    bytes,
    version: message.version,
    messageBytes,
    signaturesOffset,
    signatureCount,
    requiredSigners: message.staticAccountKeys
      .slice(0, message.numRequiredSignatures)
      .map((key) => base58.encode(key)),
    recentBlockhash: base58.encode(message.recentBlockhash),
  };
}
