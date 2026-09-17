import { z } from 'zod';
import { EvmChainId, SolanaAddress, SolanaCluster } from './chains.js';

/** Section 7.5 and T4.6. Prepaid, never on credit. */
export const SPONSOR_MARGIN = 0.15;

export const SponsorBalance = z.object({
  balanceCents: z.number().int().nonnegative(),
  /** Today's (UTC) sponsored Solana fees against the app cap, lamports as decimal strings. */
  solanaSpentTodayLamports: z.string().regex(/^\d+$/),
  solanaDailyCapLamports: z.string().regex(/^\d+$/),
});
export type SponsorBalance = z.infer<typeof SponsorBalance>;

/** Solana sponsored transactions must use this address as fee payer (account 0). */
export const SolanaFeePayerOutput = z.object({ cluster: SolanaCluster, feePayer: SolanaAddress });
export type SolanaFeePayerOutput = z.infer<typeof SolanaFeePayerOutput>;

/** EVM sponsored transactions go through a Kernel smart account owned by the embedded wallet. */
export const SmartAccountOutput = z.object({ chainId: EvmChainId, address: z.string() });
export type SmartAccountOutput = z.infer<typeof SmartAccountOutput>;

export const TopUpCheckoutInput = z.object({
  /** 5 USD minimum, 10,000 USD maximum per checkout. */
  amountCents: z.number().int().min(500).max(1_000_000),
  successUrl: z.url(),
  cancelUrl: z.url(),
});
export type TopUpCheckoutInput = z.infer<typeof TopUpCheckoutInput>;

export const TopUpCheckoutOutput = z.object({ checkoutId: z.string(), url: z.url() });
export type TopUpCheckoutOutput = z.infer<typeof TopUpCheckoutOutput>;
