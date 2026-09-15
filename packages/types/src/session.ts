import { z } from 'zod';
import { AmountString, ChainFamily, EvmAddress, EvmChainId, SolanaAddress } from './chains.js';
import { SessionSignerId, WalletId } from './ids.js';

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
 * Constraints enforced by the key provider policy (source of truth) and
 * pre-checked by our API (fail fast). Section 7.4.
 */
export const SigningPolicy = z.object({
  chain: ChainFamily,
  expiresIn: Duration,
  /** Smallest unit (wei or lamports). */
  maxValuePerTx: AmountString.optional(),
  maxValueTotal: AmountString.optional(),
  allowedChains: z.array(EvmChainId).optional(),
  allowedContracts: z.array(EvmAddress).max(50).optional(),
  allowedPrograms: z.array(SolanaAddress).max(50).optional(),
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
