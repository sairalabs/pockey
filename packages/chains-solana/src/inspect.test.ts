import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  computeBudget,
  estimateFeeLamports,
  inspectTransaction,
  programIds,
  SYSTEM_PROGRAM_ID,
  systemTransferLamportsFrom,
} from './inspect.js';

const blockhash = new PublicKey(new Uint8Array(32).fill(3)).toBase58();

function legacyTransfer(from: Keypair, lamports: number, withBudget = false): string {
  const tx = new Transaction();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = blockhash;
  if (withBudget) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }));
  }
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports,
    }),
  );
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports,
    }),
  );
  return base64.encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

describe('inspectTransaction', () => {
  it('exposes keys, instructions and program ids of a legacy transaction', () => {
    const payer = Keypair.generate();
    const tx = inspectTransaction(legacyTransfer(payer, 1000));
    expect(tx.version).toBe('legacy');
    expect(tx.staticAccountKeys[0]).toBe(payer.publicKey.toBase58());
    expect(tx.instructions).toHaveLength(2);
    expect(programIds(tx)).toEqual([SYSTEM_PROGRAM_ID]);
    expect(tx.signed).toEqual([false]);
  });

  it('sums System Program transfers from one address only', () => {
    const payer = Keypair.generate();
    const tx = inspectTransaction(legacyTransfer(payer, 2500));
    expect(systemTransferLamportsFrom(tx, payer.publicKey.toBase58())).toBe(5000n);
    expect(systemTransferLamportsFrom(tx, Keypair.generate().publicKey.toBase58())).toBe(0n);
  });

  it('reads compute budget and estimates base plus priority fees', () => {
    const payer = Keypair.generate();
    const tx = inspectTransaction(legacyTransfer(payer, 1, true));
    expect(programIds(tx)).toContain(COMPUTE_BUDGET_PROGRAM_ID);
    expect(computeBudget(tx)).toEqual({ unitLimit: 300_000, microLamportsPerUnit: 10_000n });
    // 5000 base + ceil(10_000 * 300_000 / 1_000_000) = 5000 + 3000
    expect(estimateFeeLamports(tx)).toBe(8000n);
  });

  it('handles v0 messages', () => {
    const payer = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 42,
        }),
      ],
    }).compileToV0Message();
    const encoded = base64.encode(new VersionedTransaction(message).serialize());
    const tx = inspectTransaction(encoded);
    expect(tx.version).toBe(0);
    expect(systemTransferLamportsFrom(tx, payer.publicKey.toBase58())).toBe(42n);
    expect(estimateFeeLamports(tx)).toBe(5000n);
  });
});
