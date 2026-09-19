import { COMPUTE_BUDGET_PROGRAM_ID } from '@pocketkey/chains-solana';
import type { SigningPolicy } from '@pocketkey/types';
import { ACTIVITY } from './wire.js';

/**
 * Maps a Pocketkey `SigningPolicy` to a Turnkey policy (T4.1, section 7.4).
 * Pure: the iframe builds the policy it stamps with this function, and the API
 * rebuilds it to check that the relayed body is exactly what the user consented to.
 *
 * Verified against a live organization on 2026-09-19 (TURNKEY.md): consensus on the
 * delegated user id, `eth.tx.*` and `solana.tx.*` fields, list operators, and the
 * `time` expression of `CREATE_POLICY_V3`, so Turnkey itself refuses after expiry.
 *
 * Every ALLOW policy of the delegated user is OR-ed with the others, and one Turnkey
 * wallet holds both the EVM and the Solana account. So each policy is bound to the
 * exact account address as well as the wallet: a Solana session with no program
 * allowlist must never let an EVM transaction through.
 *
 * Still enforced by Pocketkey only: `maxValueTotal` (policies are stateless).
 */

export const TURNKEY_ACTIVITY = {
  signTransaction: ACTIVITY.signTransaction,
  signRawPayload: ACTIVITY.signRawPayload,
  signRawPayloads: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOADS',
  deletePolicy: ACTIVITY.deletePolicy,
} as const;

export interface TurnkeyPolicy {
  policyName: string;
  effect: 'EFFECT_ALLOW';
  consensus: string;
  condition: string;
  time?: string;
  notes: string;
}

export interface TurnkeyPolicyTarget {
  /** Turnkey wallet id the policy is bound to. */
  walletId: string;
  /** Account address inside that wallet, exactly as Turnkey returned it. */
  address: string;
  /** Turnkey user holding the Pocketkey signer key in this sub-organization. */
  sessionUserId: string;
  policyName: string;
  /** Turnkey refuses every signature at or after this instant. */
  expiresAt: Date;
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

/** RFC 3339 at second precision with a `Z` offset, the only form Turnkey accepts. */
export function policyTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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

  const condition =
    `wallet.id == ${quote(target.walletId)} && ` +
    `wallet_account.address == ${quote(target.address)} && (${allowed.join(' || ')})`;

  const pocketkeyOnly =
    policy.maxValueTotal !== undefined ? ' Enforced by Pocketkey only: maxValueTotal.' : '';

  return {
    policyName: target.policyName,
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == ${quote(target.sessionUserId)})`,
    condition,
    time: `time.now < Timestamp(${quote(policyTimestamp(target.expiresAt))})`,
    notes: `Pocketkey session signer (${policy.chain}, ${policy.expiresIn}).${pocketkeyOnly}`,
  };
}

/**
 * Lets the Pocketkey signer delete policies in this sub-organization, so a session
 * can be revoked from the API (developer backend, dashboard, expiry cleanup). It can
 * only remove power: creating policies still needs the end user.
 */
export function revokePermissionPolicy(sessionUserId: string): TurnkeyPolicy {
  return {
    policyName: 'pocketkey:revoke',
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == ${quote(sessionUserId)})`,
    condition: `activity.type == ${quote(TURNKEY_ACTIVITY.deletePolicy)}`,
    notes: 'Lets Pocketkey revoke session signers. It cannot create or widen them.',
  };
}
