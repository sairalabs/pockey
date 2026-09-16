import { base58, base64 } from '@scure/base';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export interface SolanaTxSummary {
  instructionCount: number;
  /** Lamports moved out of `from` by System Program transfers, null when none. */
  lamportsOut: bigint | null;
}

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error('Unexpected end of transaction');
    this.offset += 1;
    return value;
  }

  /** Solana compact-u16 (1 to 3 bytes, little endian 7-bit groups). */
  compactU16(): number {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Invalid compact-u16');
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('Unexpected end of transaction');
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + i] ?? 0);
  return value;
}

/**
 * Reads a base64 wire transaction (legacy or v0) far enough to count
 * instructions and sum plain SOL transfers from `from`. Null when unreadable.
 */
export function summarizeSolanaTransaction(
  transaction: string,
  from: string,
): SolanaTxSummary | null {
  try {
    const reader = new Reader(base64.decode(transaction));
    const signatures = reader.compactU16();
    reader.take(signatures * 64);
    const first = reader.u8();
    // Versioned messages set the high bit of the first byte; the header follows.
    if ((first & 0x80) !== 0) reader.take(3);
    else reader.take(2);
    const keyCount = reader.compactU16();
    const keys: string[] = [];
    for (let i = 0; i < keyCount; i += 1) keys.push(base58.encode(reader.take(32)));
    reader.take(32); // recent blockhash
    const instructionCount = reader.compactU16();
    let lamportsOut: bigint | null = null;
    for (let i = 0; i < instructionCount; i += 1) {
      const program = keys[reader.u8()];
      const accounts = [...reader.take(reader.compactU16())];
      const data = reader.take(reader.compactU16());
      const isTransfer =
        program === SYSTEM_PROGRAM &&
        data.length >= 12 &&
        data[0] === 2 &&
        data[1] === 0 &&
        data[2] === 0 &&
        data[3] === 0;
      const source = accounts[0] === undefined ? undefined : keys[accounts[0]];
      if (isTransfer && source === from) lamportsOut = (lamportsOut ?? 0n) + readU64(data, 4);
    }
    return { instructionCount, lamportsOut };
  } catch {
    return null;
  }
}
