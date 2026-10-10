import {
  estimateFeeLamports,
  inspectTransaction,
  signTransaction,
  SolanaTransactionError,
  type InspectedTransaction,
} from '@pockey/chains-solana';
import { GasSponsorError } from './errors.js';

/**
 * Solana sponsoring (T4.4): each app has its own fee payer keypair (held by the
 * key provider in a system sub-org). The fee payer is account 0 and co-signs.
 */

/** Signs with ed25519. `signBytes` is wired to the key provider by the caller. */
export interface SolanaSigner {
  address: string;
  signBytes: (bytes: Uint8Array) => Promise<Uint8Array>;
}

export interface SolanaSponsorPolicy {
  /** Base plus priority fee cap per transaction, in lamports. */
  maxFeeLamports: bigint;
}

export const DEFAULT_SOLANA_SPONSOR_POLICY: SolanaSponsorPolicy = { maxFeeLamports: 50_000n };

function inspect(base64Tx: string): InspectedTransaction {
  try {
    return inspectTransaction(base64Tx);
  } catch (cause) {
    if (cause instanceof SolanaTransactionError) {
      throw new GasSponsorError('invalid_input', `Invalid transaction: ${cause.message}`, {
        cause,
      });
    }
    throw cause;
  }
}

function checkTransaction(
  tx: InspectedTransaction,
  feePayerAddress: string,
  policy: Partial<SolanaSponsorPolicy> | undefined,
): { feeLamports: bigint } {
  const maxFeeLamports = policy?.maxFeeLamports ?? DEFAULT_SOLANA_SPONSOR_POLICY.maxFeeLamports;

  // Accounts resolved through lookup tables are unknown offline: one of them could
  // be the fee payer, so v0 transactions with lookup tables are never sponsored.
  if (tx.addressTableLookups.length > 0) {
    throw new GasSponsorError(
      'unsupported_transaction',
      'Transactions using address lookup tables cannot be sponsored',
    );
  }

  if (tx.staticAccountKeys[0] !== feePayerAddress) {
    throw new GasSponsorError(
      'fee_payer_misuse',
      `Account 0 must be the sponsor fee payer ${feePayerAddress}`,
    );
  }
  if (tx.staticAccountKeys.slice(1).includes(feePayerAddress)) {
    throw new GasSponsorError('fee_payer_misuse', 'The fee payer is listed more than once');
  }

  // Exactly two signers: the fee payer (account 0) and the user (account 1).
  if (tx.numRequiredSignatures !== 2) {
    throw new GasSponsorError(
      'fee_payer_misuse',
      `A sponsored transaction must have exactly 2 required signers (fee payer and user), found ${tx.numRequiredSignatures}`,
    );
  }
  if (tx.numReadonlySigned > 1) {
    throw new GasSponsorError('fee_payer_misuse', 'The fee payer must be a writable signer');
  }

  tx.instructions.forEach((instruction, position) => {
    if (instruction.programIdIndex === 0 || instruction.programId === feePayerAddress) {
      throw new GasSponsorError(
        'fee_payer_misuse',
        `Instruction ${position} uses the fee payer as its program id`,
      );
    }
    for (const index of instruction.accountIndexes) {
      if (index >= tx.staticAccountKeys.length) {
        throw new GasSponsorError(
          'invalid_input',
          `Instruction ${position} references account ${index} outside the static keys`,
        );
      }
      if (index === 0 || tx.staticAccountKeys[index] === feePayerAddress) {
        throw new GasSponsorError(
          'fee_payer_misuse',
          `Instruction ${position} passes the fee payer as an account, it could move its funds`,
        );
      }
    }
  });

  const feeLamports = estimateFeeLamports(tx);
  if (feeLamports > maxFeeLamports) {
    throw new GasSponsorError(
      'fee_too_high',
      `Estimated fee ${feeLamports} lamports exceeds the sponsor cap of ${maxFeeLamports}`,
      {
        details: { feeLamports: feeLamports.toString(), maxFeeLamports: maxFeeLamports.toString() },
      },
    );
  }
  return { feeLamports };
}

/**
 * Checks that a base64 transaction is safe for `feePayerAddress` to pay for:
 * fee payer is account 0, never referenced by any instruction (neither as an
 * account nor as a program), exactly two signers, no lookup tables, fee under
 * the cap. Returns the estimated fee (base plus priority).
 */
export function validateSponsoredSolanaTransaction(
  base64Tx: string,
  feePayerAddress: string,
  policy?: Partial<SolanaSponsorPolicy>,
): { feeLamports: bigint } {
  return checkTransaction(inspect(base64Tx), feePayerAddress, policy);
}

/**
 * Validates, then signs as the user and co-signs as the fee payer. Both slots are
 * filled through chains-solana `signTransaction`, other slots stay untouched.
 */
export async function sponsorSolanaTransaction(input: {
  transaction: string;
  feePayer: SolanaSigner;
  user: SolanaSigner;
  policy?: Partial<SolanaSponsorPolicy>;
}): Promise<{ signedTransaction: string; feeLamports: bigint }> {
  const { transaction, feePayer, user } = input;
  if (user.address === feePayer.address) {
    throw new GasSponsorError('fee_payer_misuse', 'The user cannot be the fee payer');
  }
  const tx = inspect(transaction);
  const { feeLamports } = checkTransaction(tx, feePayer.address, input.policy);
  if (tx.staticAccountKeys[1] !== user.address) {
    throw new GasSponsorError(
      'fee_payer_misuse',
      `The user ${user.address} must be the second required signer`,
    );
  }

  const userSigned = await signTransaction(transaction, {
    publicKey: user.address,
    signBytes: user.signBytes,
  });
  const signedTransaction = await signTransaction(userSigned, {
    publicKey: feePayer.address,
    signBytes: feePayer.signBytes,
  });
  return { signedTransaction, feeLamports };
}
