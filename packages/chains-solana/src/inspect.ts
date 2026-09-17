import { base58, base64 } from '@scure/base';
import { SolanaTransactionError } from './errors.js';
import { parseMessage, parseTransaction } from './wire.js';

/**
 * Read-only view of a transaction for policy checks (session signers) and gas
 * sponsoring (fee payer safety, fee estimation). Never signs anything.
 */

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
export const LAMPORTS_PER_SIGNATURE = 5000n;

export interface InspectedInstruction {
  /** Programs are always static keys (the runtime refuses lookup-table program ids). */
  programId: string;
  programIdIndex: number;
  /** Indexes into static keys first, then lookup table accounts. */
  accountIndexes: number[];
  data: Uint8Array;
}

export interface InspectedTransaction {
  version: 'legacy' | 0;
  /** Base58 static account keys; index 0 is the fee payer. */
  staticAccountKeys: string[];
  numRequiredSignatures: number;
  numReadonlySigned: number;
  numReadonlyUnsigned: number;
  recentBlockhash: string;
  instructions: InspectedInstruction[];
  addressTableLookups: {
    accountKey: string;
    writableIndexes: number[];
    readonlyIndexes: number[];
  }[];
  /** True when the signature slot of that required signer is already filled. */
  signed: boolean[];
}

export function inspectTransaction(base64Tx: string): InspectedTransaction {
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(base64Tx);
  } catch (cause) {
    throw new SolanaTransactionError('Transaction is not valid base64', { cause });
  }
  const tx = parseTransaction(bytes);
  const message = parseMessage(tx.messageBytes);
  const staticAccountKeys = message.staticAccountKeys.map((key) => base58.encode(key));

  const instructions = message.instructions.map((instruction) => {
    const programId = staticAccountKeys[instruction.programIdIndex];
    if (programId === undefined) {
      throw new SolanaTransactionError('Instruction program id is not a static account key');
    }
    return { programId, ...instruction };
  });

  const signed: boolean[] = [];
  for (let i = 0; i < tx.signatureCount; i++) {
    const start = tx.signaturesOffset + i * 64;
    signed.push(tx.bytes.slice(start, start + 64).some((byte) => byte !== 0));
  }

  return {
    version: message.version,
    staticAccountKeys,
    numRequiredSignatures: message.numRequiredSignatures,
    numReadonlySigned: message.numReadonlySigned,
    numReadonlyUnsigned: message.numReadonlyUnsigned,
    recentBlockhash: base58.encode(message.recentBlockhash),
    instructions,
    addressTableLookups: message.addressTableLookups.map((lookup) => ({
      accountKey: base58.encode(lookup.accountKey),
      writableIndexes: lookup.writableIndexes,
      readonlyIndexes: lookup.readonlyIndexes,
    })),
    signed,
  };
}

/** Distinct program ids invoked by the transaction. */
export function programIds(tx: InspectedTransaction): string[] {
  return [...new Set(tx.instructions.map((instruction) => instruction.programId))];
}

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

/**
 * Lamports moved out of `address` by System Program `Transfer` instructions.
 * Other ways to move SOL (TransferWithSeed, CPI through other programs) are not
 * counted, which is why sessions with a value cap should also set allowedPrograms.
 */
export function systemTransferLamportsFrom(tx: InspectedTransaction, address: string): bigint {
  let total = 0n;
  for (const instruction of tx.instructions) {
    if (instruction.programId !== SYSTEM_PROGRAM_ID) continue;
    if (instruction.data.length !== 12 || u32(instruction.data, 0) !== 2) continue;
    const fromIndex = instruction.accountIndexes[0];
    if (fromIndex === undefined || tx.staticAccountKeys[fromIndex] !== address) continue;
    total += u64(instruction.data, 4);
  }
  return total;
}

/** Compute budget settings, used to estimate priority fees. */
export function computeBudget(tx: InspectedTransaction): {
  unitLimit: number | null;
  microLamportsPerUnit: bigint | null;
} {
  let unitLimit: number | null = null;
  let microLamportsPerUnit: bigint | null = null;
  for (const instruction of tx.instructions) {
    if (instruction.programId !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    const kind = instruction.data[0];
    if (kind === 2 && instruction.data.length === 5) unitLimit = u32(instruction.data, 1);
    if (kind === 3 && instruction.data.length === 9)
      microLamportsPerUnit = u64(instruction.data, 1);
  }
  return { unitLimit, microLamportsPerUnit };
}

/** Base fee plus priority fee, in lamports. Default compute limit is 200k per instruction. */
export function estimateFeeLamports(tx: InspectedTransaction): bigint {
  const base = LAMPORTS_PER_SIGNATURE * BigInt(tx.numRequiredSignatures);
  const { unitLimit, microLamportsPerUnit } = computeBudget(tx);
  if (!microLamportsPerUnit) return base;
  const units = BigInt(unitLimit ?? Math.min(1_400_000, 200_000 * tx.instructions.length));
  return base + (microLamportsPerUnit * units + 999_999n) / 1_000_000n;
}
