import { z } from 'zod';

/** Append-only, aggregated hourly into `usage_monthly`. */
export const UsageEventType = z.enum([
  'wallet.created',
  'user.active',
  'tx.signed',
  'tx.sponsored',
  'session.signed',
]);
export type UsageEventType = z.infer<typeof UsageEventType>;

/** `YYYY-MM` in UTC. */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export type Month = z.infer<typeof Month>;

export const UsageMonthly = z.object({
  month: Month,
  activeUsers: z.number().int().nonnegative(),
  walletsCreated: z.number().int().nonnegative(),
  txSigned: z.number().int().nonnegative(),
  sessionSigned: z.number().int().nonnegative(),
  gasSponsoredWei: z.string().regex(/^\d+$/),
  gasSponsoredLamports: z.string().regex(/^\d+$/),
});
export type UsageMonthly = z.infer<typeof UsageMonthly>;
