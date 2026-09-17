import { COMPUTE_BUDGET_PROGRAM_ID } from '@pocketkey/chains-solana';
import type { SigningPolicy } from '@pocketkey/types';

/**
 * Maps a Pocketkey `SigningPolicy` to a Turnkey policy (T4.1, section 7.4).
 * Pure: no Turnkey SDK import, the Turnkey adapter sends the result as is.
 *
 * TO RE-VERIFY DURING T0.5: the condition and consensus syntax below follows the
 * Turnkey policy language as documented when this was written (`approvers.any`,
 * `wallet.id`, `activity.type`, `eth.tx.chain_id`, `eth.tx.to`, `eth.tx.value`,
 * `solana.tx.program_keys`, `solana.tx.transfers`). It has not been run against a
 * Turnkey sandbox yet. Check field names, list operators and address casing
 * against the Turnkey docs and a real `createPolicy` call before relying on it.
 *
 * Not expressible in a Turnkey policy, so enforced by Pocketkey only:
 * - `maxValueTotal` (policies are stateless),
 * - `expiresIn` (policies cannot express a date; the hourly cron deletes expired ones).
 */

export const TURNKEY_ACTIVITY = {
  signTransaction: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
  signRawPayload: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
  signRawPayloads: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOADS',
} as const;

export interface TurnkeyPolicy {
  policyName: string;
  effect: 'EFFECT_ALLOW';
  consensus: string;
  condition: string;
  notes: string;
}

export interface TurnkeyPolicyTarget {
  /** Turnkey wallet id the policy is bound to. */
  walletId: string;
  /** Turnkey user holding the API key our backend signs with for this session. */
  sessionUserId: string;
  policyName: string;
  /**
   * Allows raw payload signing (session message and typed data signatures).
   * Turnkey cannot tell a message digest from a transaction digest, so a raw
   * payload escapes every `eth.tx.*` / `solana.tx.*` condition. Defaults to the
   * policy `allowMessages` flag (off unless the user consented to it).
   */
  allowRawPayloads?: boolean;
}

/** Single-quoted policy language string literal. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const list = (values: readonly string[]) => `[${values.join(', ')}]`;

export function toTurnkeyPolicy(policy: SigningPolicy, target: TurnkeyPolicyTarget): TurnkeyPolicy {
  const txConditions = [`activity.type == ${quote(TURNKEY_ACTIVITY.signTransaction)}`];

  if (policy.chain === 'evm') {
    if (policy.allowedChains) {
      txConditions.push(`eth.tx.chain_id in ${list(policy.allowedChains.map(String))}`);
    }
    if (policy.allowedContracts) {
      const contracts = policy.allowedContracts.map((address) => quote(address.toLowerCase()));
      txConditions.push(`eth.tx.to in ${list(contracts)}`);
    }
    if (policy.maxValuePerTx !== undefined) {
      txConditions.push(`eth.tx.value <= ${BigInt(policy.maxValuePerTx).toString()}`);
    }
  } else {
    if (policy.allowedPrograms) {
      const programs = [...new Set([...policy.allowedPrograms, COMPUTE_BUDGET_PROGRAM_ID])];
      txConditions.push(`solana.tx.program_keys.all(p, p in ${list(programs.map(quote))})`);
    }
    if (policy.maxValuePerTx !== undefined) {
      // Per transfer, not per transaction: Pocketkey pre-checks the per transaction sum.
      txConditions.push(
        `solana.tx.transfers.all(t, t.amount <= ${BigInt(policy.maxValuePerTx).toString()})`,
      );
    }
  }

  const allowed = [
    txConditions.length === 1 ? txConditions.join('') : `(${txConditions.join(' && ')})`,
  ];
  if (target.allowRawPayloads ?? policy.allowMessages === true) {
    allowed.push(
      `activity.type in ${list([TURNKEY_ACTIVITY.signRawPayload, TURNKEY_ACTIVITY.signRawPayloads].map(quote))}`,
    );
  }

  const condition = `wallet.id == ${quote(target.walletId)} && (${allowed.join(' || ')})`;

  const pocketkeyOnly = ['expiry'];
  if (policy.maxValueTotal !== undefined) pocketkeyOnly.push('maxValueTotal');

  return {
    policyName: target.policyName,
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == ${quote(target.sessionUserId)})`,
    condition,
    notes: `Pocketkey session signer (${policy.chain}, ${policy.expiresIn}). Enforced by Pocketkey only: ${pocketkeyOnly.join(', ')}.`,
  };
}
