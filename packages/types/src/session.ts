import { z } from 'zod';
import { AmountString, ChainFamily, EvmAddress, EvmChainId, SolanaAddress } from './chains.js';
import { SessionSignerId, WalletId } from './ids.js';
import { SignMessageInput, SignTypedDataInput, TransactionRequest } from './wallet.js';

/** Human duration accepted by the SDK: `15m`, `2h`, `7d`. Max 30 days. */
export const Duration = z
  .string()
  .regex(/^\d+(m|h|d)$/, 'Expected a duration like "15m", "2h" or "7d"')
  .refine((value) => {
    // Zod 4 keeps running checks after a failed one, so never throw here.
    const seconds = tryDurationToSeconds(value);
    return seconds !== null && seconds <= 30 * 24 * 3600;
  }, 'Sessions cannot exceed 30 days');
export type Duration = z.infer<typeof Duration>;

function tryDurationToSeconds(value: string): number | null {
  const match = /^(\d+)(m|h|d)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * factor;
}

export function durationToSeconds(value: string): number {
  const seconds = tryDurationToSeconds(value);
  if (seconds === null) throw new Error(`Invalid duration: ${value}`);
  return seconds;
}

/**
 * A session that may sign messages is closer to a blank cheque (raw hashes escape
 * the key provider conditions), so it lives for hours, not weeks.
 */
export const MAX_MESSAGE_SESSION_SECONDS = 24 * 3600;

/**
 * Constraints enforced by the key provider policy (source of truth) and
 * pre-checked by our API (fail fast). Section 7.4.
 */
export const SigningPolicy = z
  .object({
    chain: ChainFamily,
    expiresIn: Duration,
    /** Smallest unit (wei or lamports). */
    maxValuePerTx: AmountString.optional(),
    maxValueTotal: AmountString.optional(),
    allowedChains: z.array(EvmChainId).optional(),
    allowedContracts: z.array(EvmAddress).max(50).optional(),
    allowedPrograms: z.array(SolanaAddress).max(50).optional(),
    /**
     * Also allow message and typed data signatures. Off by default: the key provider
     * cannot tell a message hash from a transaction hash, so enabling it lets a
     * compromised backend get any hash signed while the session is active.
     */
    allowMessages: z.boolean().optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.allowMessages !== true) return;
    const seconds = tryDurationToSeconds(policy.expiresIn);
    if (seconds !== null && seconds > 24 * 3600) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresIn'],
        message: 'Sessions that allow message signatures cannot exceed 24 hours',
      });
    }
  });
export type SigningPolicy = z.infer<typeof SigningPolicy>;

export const CreateSessionInput = z.object({
  walletId: WalletId,
  policy: SigningPolicy,
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const SessionSigner = z.object({
  id: SessionSignerId,
  walletId: WalletId,
  policy: SigningPolicy,
  /** Running total spent under this session, smallest unit. */
  spentTotal: AmountString,
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type SessionSigner = z.infer<typeof SessionSigner>;

/* Session signing requests (T4.2). The same shape is used by the end user
   (`POST /v1/sessions/:id/sign`, no confirmation screen) and by the developer
   backend (`POST /v1/server/users/:id/wallets/:wid/sign`, secret API key). */

export const SessionSignRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), input: SignMessageInput }),
  /** Only allowed when the policy has a contract allowlist that contains the domain verifyingContract. */
  z.object({ kind: z.literal('typedData'), input: SignTypedDataInput }),
  z.object({
    kind: z.literal('transaction'),
    input: TransactionRequest,
    /** Broadcast after signing. False returns the signed transaction only. */
    broadcast: z.boolean().default(true),
    sponsored: z.boolean().default(false),
  }),
]);
export type SessionSignRequest = z.infer<typeof SessionSignRequest>;
export type SessionSignRequestInput = z.input<typeof SessionSignRequest>;

export const SessionSignOutput = z.object({
  /** Message and typed data signatures. */
  signature: z.string().optional(),
  /** Transactions signed without broadcast. */
  signedTransaction: z.string().optional(),
  /** Broadcast transactions: tx hash, user operation hash (sponsored EVM) or Solana signature. */
  hash: z.string().optional(),
  sponsored: z.boolean(),
});
export type SessionSignOutput = z.infer<typeof SessionSignOutput>;

export const SessionList = z.object({ sessions: z.array(SessionSigner) });
export type SessionList = z.infer<typeof SessionList>;

export const ServerSignInput = z.object({
  sessionId: SessionSignerId,
  request: SessionSignRequest,
});
export type ServerSignInput = z.infer<typeof ServerSignInput>;

/** Stable machine reasons returned in `details.reason` when a policy refuses a request. */
export const POLICY_VIOLATIONS = [
  'session_expired',
  'session_revoked',
  'wallet_mismatch',
  'chain_not_allowed',
  'contract_not_allowed',
  'program_not_allowed',
  'value_per_tx_exceeded',
  'value_total_exceeded',
  'typed_data_not_allowed',
  'messages_not_allowed',
] as const;
export type PolicyViolation = (typeof POLICY_VIOLATIONS)[number];
