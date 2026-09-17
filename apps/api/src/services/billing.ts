import { apps, developers, usageEvents, type Db, type DeveloperRow } from '@pocketkey/db';
import type { EnsureCustomerInput, Payments } from '@pocketkey/payments';
import { and, countDistinct, eq, gte, isNotNull, lt } from 'drizzle-orm';
import type { ParsedEnv } from '../env.js';

/**
 * Usage based billing of section 11 (T5.4). The Stripe calls themselves live in
 * `@pocketkey/payments`; this is the part that knows about developers, apps and
 * `usage_events`.
 *
 * Nothing here is on the request path of the SDK: `ensureBilling` runs when a
 * developer opens the billing portal, `meterActiveWallets` runs on the nightly
 * cron of `wrangler.jsonc`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `YYYY-MM-DD`, UTC. */
export function utcDayKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/** Idempotency key of one daily report. Stripe deduplicates meter events on it. */
export function meterIdentifier(developerId: string, day: string): string {
  return `maw:${developerId}:${day}`;
}

/**
 * Whether this server can set up the usage based plan. The mock provider always
 * can; Stripe needs the metered price id, which is optional outside production.
 */
export function billingConfigured(config: ParsedEnv): boolean {
  return config.PAYMENTS !== 'stripe' || config.STRIPE_ACTIVE_WALLET_PRICE_ID !== undefined;
}

/**
 * Stripe customer and metered subscription of a developer, created once and
 * reused afterwards. Returns the customer id, or null when billing is not
 * configured on this server (the caller then answers 400).
 *
 * The customer id is persisted on `developers.stripe_customer_id`. The
 * subscription id is not stored: `@pocketkey/payments` creates it under an
 * idempotency key derived from the customer id, so asking again returns the
 * same subscription instead of a second one.
 */
export async function ensureBilling(
  db: Db,
  payments: Payments,
  developer: DeveloperRow,
  config: ParsedEnv,
): Promise<string | null> {
  if (!billingConfigured(config)) return null;

  const input: EnsureCustomerInput = { developerId: developer.id, email: developer.email };
  if (developer.name !== null) input.name = developer.name;
  if (developer.stripeCustomerId !== null) input.existingCustomerId = developer.stripeCustomerId;

  const customer = await payments.ensureCustomer(input);
  if (customer.customerId !== developer.stripeCustomerId) {
    await db
      .update(developers)
      .set({ stripeCustomerId: customer.customerId })
      .where(eq(developers.id, developer.id));
  }

  await payments.ensureUsageSubscription({
    customerId: customer.customerId,
    developerId: developer.id,
  });
  return customer.customerId;
}

export interface MeterActiveWalletsResult {
  /** UTC day reported, `YYYY-MM-DD`. */
  day: string;
  /** Developers that got a meter event. */
  developers: number;
  /** Active wallets reported across them. */
  activeWallets: number;
  /** Developers whose event the provider refused. */
  failed: number;
}

/**
 * Reports one day of monthly active wallets to Stripe (section 7.6, "envoi a
 * Stripe Meters chaque nuit"). A `user.active` event is written once per user
 * and per month, so the count of a single day is exactly the wallets that
 * became active that day, and the month adds up without double counting.
 *
 * Only developers that already have a Stripe customer are reported, developers
 * with nothing that day are skipped, and the identifier makes a re-run a no-op.
 */
export async function meterActiveWallets(
  db: Db,
  payments: Payments,
  options: { date: Date },
): Promise<MeterActiveWalletsResult> {
  const start = startOfUtcDay(options.date);
  const end = new Date(start.getTime() + DAY_MS);
  const day = utcDayKey(start);
  // Midday: an instant that is unambiguously inside the day being reported.
  const timestampSeconds = Math.floor((start.getTime() + DAY_MS / 2) / 1000);

  const rows = await db
    .select({
      developerId: apps.developerId,
      customerId: developers.stripeCustomerId,
      activeWallets: countDistinct(usageEvents.endUserId),
    })
    .from(usageEvents)
    .innerJoin(apps, eq(usageEvents.appId, apps.id))
    .innerJoin(developers, eq(apps.developerId, developers.id))
    .where(
      and(
        eq(usageEvents.type, 'user.active'),
        gte(usageEvents.createdAt, start),
        lt(usageEvents.createdAt, end),
        isNotNull(developers.stripeCustomerId),
      ),
    )
    .groupBy(apps.developerId, developers.stripeCustomerId);

  const result: MeterActiveWalletsResult = { day, developers: 0, activeWallets: 0, failed: 0 };
  for (const row of rows) {
    const customerId = row.customerId;
    if (customerId === null || row.activeWallets <= 0) continue;
    try {
      await payments.recordActiveWallets({
        customerId,
        event: {
          identifier: meterIdentifier(row.developerId, day),
          value: row.activeWallets,
          timestampSeconds,
        },
      });
      result.developers += 1;
      result.activeWallets += row.activeWallets;
    } catch (error) {
      // One refused developer must not stop the others: the identifier makes
      // tomorrow's run able to send the same day again.
      result.failed += 1;
      console.error(`[billing] meter event refused for ${row.developerId} on ${day}`, error);
    }
  }
  return result;
}

/**
 * What the nightly cron runs: yesterday, and the day before it. The second one
 * is free insurance after an outage, since Stripe deduplicates on the
 * identifier and a day that was already reported changes nothing.
 */
export async function meterRecentDays(
  db: Db,
  payments: Payments,
  now: Date,
): Promise<MeterActiveWalletsResult[]> {
  const today = startOfUtcDay(now).getTime();
  const results: MeterActiveWalletsResult[] = [];
  for (const daysBack of [2, 1]) {
    results.push(
      await meterActiveWallets(db, payments, { date: new Date(today - daysBack * DAY_MS) }),
    );
  }
  return results;
}
