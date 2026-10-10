import {
  COMPUTE_BUDGET_PROGRAM_ID,
  programIds,
  systemTransferLamportsFrom,
  type InspectedTransaction,
} from '@pockey/chains-solana';
import type {
  ChainFamily,
  EvmChainId,
  PolicyViolation,
  SessionSignRequest,
  SigningPolicy,
  SolanaCluster,
} from '@pockey/types';

/**
 * Local policy check for session signers (T4.2, section 7.4). Pockey fails
 * fast here, the key provider re-checks what it can (chain, contract, per
 * transaction value, programs, expiry). `maxValueTotal`, revocation and the
 * typed data rule only exist here (DECISIONS.md, phase 4). Pure, no I/O.
 */

export interface SessionState {
  walletId: string;
  policy: SigningPolicy;
  /** Decimal string, smallest unit. */
  spentTotal: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PolicyContext {
  now: Date;
  wallet: { id: string; chainFamily: ChainFamily; address: string };
  enabledChains: { evm: readonly EvmChainId[]; solana: readonly SolanaCluster[] };
  /** Required for EVM transaction requests: the prepared transaction. */
  evmTransaction?: { chainId: number; to: string | null; value: bigint };
  /** Required for Solana transaction requests. */
  solanaTransaction?: InspectedTransaction;
}

export type PolicyCheck = { ok: true; value: bigint } | { ok: false; reason: PolicyViolation };

export const VIOLATION_MESSAGES: Record<PolicyViolation, string> = {
  session_expired: 'This session has expired',
  session_revoked: 'This session was revoked',
  wallet_mismatch: 'This session does not apply to this wallet or chain',
  chain_not_allowed: 'This chain is not allowed by the session policy',
  contract_not_allowed: 'This contract is not allowed by the session policy',
  program_not_allowed: 'A program in this transaction is not allowed by the session policy',
  value_per_tx_exceeded: 'The transaction value exceeds the per transaction limit',
  value_total_exceeded: 'The transaction would exceed the session spending limit',
  typed_data_not_allowed:
    'Typed data needs a contract allowlist that contains the domain verifying contract',
  messages_not_allowed:
    'This session does not allow message signatures (also required for sponsored EVM sends, signed as raw user operation hashes)',
};

const deny = (reason: PolicyViolation): PolicyCheck => ({ ok: false, reason });

/** Revocation and expiry only, usable before any expensive preparation. */
export function checkSessionState(session: SessionState, now: Date): PolicyCheck {
  if (session.revokedAt !== null) return deny('session_revoked');
  if (now.getTime() >= session.expiresAt.getTime()) return deny('session_expired');
  return { ok: true, value: 0n };
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function checkValue(policy: SigningPolicy, spentTotal: string, value: bigint): PolicyCheck {
  if (policy.maxValuePerTx !== undefined && value > BigInt(policy.maxValuePerTx)) {
    return deny('value_per_tx_exceeded');
  }
  if (
    policy.maxValueTotal !== undefined &&
    BigInt(spentTotal) + value > BigInt(policy.maxValueTotal)
  ) {
    return deny('value_total_exceeded');
  }
  return { ok: true, value };
}

export function checkSessionRequest(
  session: SessionState,
  request: SessionSignRequest,
  context: PolicyContext,
): PolicyCheck {
  const state = checkSessionState(session, context.now);
  if (!state.ok) return state;

  const { policy } = session;
  const { wallet } = context;
  if (session.walletId !== wallet.id || policy.chain !== wallet.chainFamily) {
    return deny('wallet_mismatch');
  }

  switch (request.kind) {
    case 'message':
      if (request.input.chain !== wallet.chainFamily) return deny('wallet_mismatch');
      // Raw payloads escape every transaction condition at the key provider (DECISIONS.md).
      if (policy.allowMessages !== true) return deny('messages_not_allowed');
      return { ok: true, value: 0n };

    case 'typedData': {
      if (wallet.chainFamily !== 'evm') return deny('wallet_mismatch');
      if (policy.allowMessages !== true) return deny('messages_not_allowed');
      // A Permit or a signed order can drain a wallet without any transaction.
      const verifying = request.input.domain.verifyingContract;
      if (
        verifying === undefined ||
        !policy.allowedContracts?.some((address) => sameAddress(address, verifying))
      ) {
        return deny('typed_data_not_allowed');
      }
      return { ok: true, value: 0n };
    }

    case 'transaction': {
      const input = request.input;
      if (input.chain !== wallet.chainFamily) return deny('wallet_mismatch');
      // ERC-4337 user operations are signed as raw hashes, which the key provider cannot constrain.
      if (input.chain === 'evm' && request.sponsored && policy.allowMessages !== true) {
        return deny('messages_not_allowed');
      }

      if (input.chain === 'evm') {
        const tx = context.evmTransaction;
        if (tx?.chainId !== input.chainId) return deny('wallet_mismatch');
        if (!context.enabledChains.evm.includes(input.chainId)) return deny('chain_not_allowed');
        if (policy.allowedChains && !policy.allowedChains.includes(input.chainId)) {
          return deny('chain_not_allowed');
        }
        if (policy.allowedContracts) {
          const to = tx.to;
          if (to === null || !policy.allowedContracts.some((address) => sameAddress(address, to))) {
            return deny('contract_not_allowed');
          }
        }
        return checkValue(policy, session.spentTotal, tx.value);
      }

      const tx = context.solanaTransaction;
      if (!tx) return deny('wallet_mismatch');
      if (!context.enabledChains.solana.includes(input.cluster)) return deny('chain_not_allowed');
      if (policy.allowedPrograms) {
        const allowed = new Set<string>([...policy.allowedPrograms, COMPUTE_BUDGET_PROGRAM_ID]);
        if (programIds(tx).some((programId) => !allowed.has(programId))) {
          return deny('program_not_allowed');
        }
      }
      return checkValue(policy, session.spentTotal, systemTransferLamportsFrom(tx, wallet.address));
    }
  }
}
