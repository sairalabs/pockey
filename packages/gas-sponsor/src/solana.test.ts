import { ed25519 } from '@noble/curves/ed25519.js';
import { estimateFeeLamports, inspectTransaction } from '@pocketkey/chains-solana';
import { base64 } from '@scure/base';
import {
  AddressLookupTableAccount,
  type AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { GasSponsorError } from './errors.js';
import {
  sponsorSolanaTransaction,
  validateSponsoredSolanaTransaction,
  type SolanaSigner,
} from './solana.js';

const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58();

function signerFor(keypair: Keypair, log?: string[]): SolanaSigner {
  const address = keypair.publicKey.toBase58();
  return {
    address,
    signBytes: async (bytes) => {
      log?.push(address);
      return ed25519.sign(bytes, keypair.secretKey.slice(0, 32));
    },
  };
}

function legacy(feePayer: PublicKey, instructions: TransactionInstruction[]): string {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(...instructions);
  return base64.encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

function v0(
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  return base64.encode(new VersionedTransaction(message).serialize());
}

function transfer(from: PublicKey, to: PublicKey = Keypair.generate().publicKey, lamports = 1000) {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Arbitrary instruction. Data is borrowed from a real instruction to keep web3.js Buffer typing. */
function customInstruction(programId: PublicKey, keys: AccountMeta[]): TransactionInstruction {
  const instruction = ComputeBudgetProgram.setComputeUnitLimit({ units: 1 });
  instruction.programId = programId;
  instruction.keys = keys;
  return instruction;
}

function setup() {
  const payer = Keypair.generate();
  const user = Keypair.generate();
  return { payer, user, payerAddress: payer.publicKey.toBase58() };
}

function expectCode(run: () => unknown, code: GasSponsorError['code'], message?: RegExp): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GasSponsorError);
    const typed = error as GasSponsorError;
    expect(typed.code).toBe(code);
    if (message) expect(typed.message).toMatch(message);
    return;
  }
  throw new Error(`Expected GasSponsorError ${code}`);
}

function verifyAllSignatures(signedBase64: string): string[] {
  const tx = VersionedTransaction.deserialize(base64.decode(signedBase64));
  const message = tx.message.serialize();
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  signers.forEach((key, index) => {
    const signature = tx.signatures[index];
    expect(signature).toBeDefined();
    expect(ed25519.verify(signature ?? new Uint8Array(64), message, key.toBytes())).toBe(true);
  });
  return signers.map((key) => key.toBase58());
}

describe('sponsorSolanaTransaction', () => {
  it('signs a legacy transfer as user then fee payer, both signatures verify', async () => {
    const { payer, user } = setup();
    const order: string[] = [];
    const tx = legacy(payer.publicKey, [transfer(user.publicKey)]);

    const result = await sponsorSolanaTransaction({
      transaction: tx,
      feePayer: signerFor(payer, order),
      user: signerFor(user, order),
    });

    expect(order).toEqual([user.publicKey.toBase58(), payer.publicKey.toBase58()]);
    expect(verifyAllSignatures(result.signedTransaction)).toEqual([
      payer.publicKey.toBase58(),
      user.publicKey.toBase58(),
    ]);
    expect(result.feeLamports).toBe(estimateFeeLamports(inspectTransaction(tx)));
    expect(result.feeLamports).toBe(10_000n);
  });

  it('signs a v0 transfer with a priority fee under the cap', async () => {
    const { payer, user } = setup();
    const tx = v0(payer.publicKey, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      transfer(user.publicKey),
    ]);

    const result = await sponsorSolanaTransaction({
      transaction: tx,
      feePayer: signerFor(payer),
      user: signerFor(user),
    });

    verifyAllSignatures(result.signedTransaction);
    expect(result.feeLamports).toBe(estimateFeeLamports(inspectTransaction(tx)));
    // 2 * 5000 + ceil(50_000 * 100_000 / 1_000_000)
    expect(result.feeLamports).toBe(15_000n);
    expect(inspectTransaction(result.signedTransaction).signed).toEqual([true, true]);
  });

  it('refuses a user that is not a required signer', async () => {
    const { payer, user } = setup();
    const other = Keypair.generate();
    const tx = legacy(payer.publicKey, [transfer(other.publicKey, user.publicKey)]);
    await expect(
      sponsorSolanaTransaction({
        transaction: tx,
        feePayer: signerFor(payer),
        user: signerFor(user),
      }),
    ).rejects.toMatchObject({ code: 'fee_payer_misuse', message: /second required signer/ });
  });

  it('refuses the fee payer acting as the user', async () => {
    const { payer } = setup();
    const tx = legacy(payer.publicKey, [transfer(payer.publicKey)]);
    await expect(
      sponsorSolanaTransaction({
        transaction: tx,
        feePayer: signerFor(payer),
        user: signerFor(payer),
      }),
    ).rejects.toMatchObject({ code: 'fee_payer_misuse' });
  });

  it('does not call any signer when validation fails', async () => {
    const { payer, user } = setup();
    const order: string[] = [];
    const tx = legacy(payer.publicKey, [transfer(payer.publicKey)]);
    await expect(
      sponsorSolanaTransaction({
        transaction: tx,
        feePayer: signerFor(payer, order),
        user: signerFor(user, order),
      }),
    ).rejects.toBeInstanceOf(GasSponsorError);
    expect(order).toEqual([]);
  });
});

describe('validateSponsoredSolanaTransaction', () => {
  it('accepts a safe transaction and returns the estimated fee', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [transfer(user.publicKey)]);
    expect(validateSponsoredSolanaTransaction(tx, payerAddress)).toEqual({ feeLamports: 10_000n });
  });

  it('refuses the fee payer in an instruction account list', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [transfer(user.publicKey), transfer(payer.publicKey)]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'fee_payer_misuse',
      /Instruction 1 passes the fee payer/,
    );
  });

  it('refuses the fee payer as a transfer destination too', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [transfer(user.publicKey, payer.publicKey)]);
    expectCode(() => validateSponsoredSolanaTransaction(tx, payerAddress), 'fee_payer_misuse');
  });

  it('refuses the fee payer as a program id', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [
      customInstruction(payer.publicKey, [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
      ]),
    ]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'fee_payer_misuse',
      /program id/,
    );
  });

  it('refuses extra signers', () => {
    const { payer, user, payerAddress } = setup();
    const other = Keypair.generate();
    const tx = legacy(payer.publicKey, [transfer(user.publicKey), transfer(other.publicKey)]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'fee_payer_misuse',
      /exactly 2 required signers.*found 3/,
    );
  });

  it('refuses a transaction signed by the fee payer alone', () => {
    const { payer, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [customInstruction(MEMO_PROGRAM, [])]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'fee_payer_misuse',
      /found 1/,
    );
  });

  it('refuses a fee payer that is not account 0', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(user.publicKey, [
      transfer(user.publicKey),
      customInstruction(MEMO_PROGRAM, [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ]),
    ]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'fee_payer_misuse',
      /Account 0 must be the sponsor fee payer/,
    );
  });

  it('refuses v0 transactions with address lookup tables', () => {
    const { payer, user, payerAddress } = setup();
    const recipient = Keypair.generate().publicKey;
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [recipient],
      },
    });
    const tx = v0(payer.publicKey, [transfer(user.publicKey, recipient)], [table]);
    expect(inspectTransaction(tx).addressTableLookups).toHaveLength(1);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress),
      'unsupported_transaction',
    );
  });

  it('refuses a fee above the default cap', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      transfer(user.publicKey),
    ]);
    // 10_000 base + 1 lamport per unit * 400_000 default units (2 instructions)
    expect(estimateFeeLamports(inspectTransaction(tx))).toBe(410_000n);
    expectCode(() => validateSponsoredSolanaTransaction(tx, payerAddress), 'fee_too_high');
  });

  it('applies a custom fee cap', () => {
    const { payer, user, payerAddress } = setup();
    const tx = legacy(payer.publicKey, [transfer(user.publicKey)]);
    expectCode(
      () => validateSponsoredSolanaTransaction(tx, payerAddress, { maxFeeLamports: 9_999n }),
      'fee_too_high',
    );
    expect(
      validateSponsoredSolanaTransaction(tx, payerAddress, { maxFeeLamports: 10_000n }),
    ).toEqual({ feeLamports: 10_000n });
  });

  it('maps undecodable payloads to invalid_input', () => {
    expectCode(
      () => validateSponsoredSolanaTransaction('not base64!', setup().payerAddress),
      'invalid_input',
    );
  });
});
