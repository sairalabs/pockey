import {
  apps,
  newId,
  appSystemWallets,
  paymentEvents,
  sponsorBalances,
  sponsorLedger,
  usageEvents,
  type AppRow,
  type AppSystemWalletRow,
  type Db,
} from '@pocketkey/db';
import type { KeyProvider } from '@pocketkey/key-provider';
import type { PaymentEvent } from '@pocketkey/payments';
import { AppConfig, SponsorBalance } from '@pocketkey/types';
import { and, eq, gte, sql } from 'drizzle-orm';
import { ApiError } from '../errors.js';
import { providerFailure } from './provider-failure.js';

/**
 * Prepaid gas sponsoring balances (T4.6, section 7.5). Never on credit: a charge
 * is one conditional UPDATE that only succeeds when the balance covers it, and
 * every movement is written to `sponsor_ledger` with a unique reference.
 */

async function ensureBalanceRow(db: Db, appId: string): Promise<void> {
  await db.insert(sponsorBalances).values({ appId, balanceCents: 0 }).onConflictDoNothing();
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Sum of today's (UTC) sponsored Solana fees, in lamports. */
export async function solanaSpentTodayLamports(db: Db, appId: string, now: Date): Promise<bigint> {
  const rows = await db
    .select({ amount: usageEvents.amount, meta: usageEvents.meta })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.appId, appId),
        eq(usageEvents.type, 'tx.sponsored'),
        gte(usageEvents.createdAt, startOfUtcDay(now)),
      ),
    );
  let total = 0n;
  for (const row of rows) {
    if (row.meta?.chain !== 'solana' || !row.amount || !/^\d+$/.test(row.amount)) continue;
    total += BigInt(row.amount);
  }
  return total;
}

/**
 * Balance and today's Solana spending. `solanaDailyCapLamports` of `'0'` means no
 * daily cap: the prepaid balance is then the only limit.
 */
export async function getBalance(db: Db, app: AppRow, now = new Date()): Promise<SponsorBalance> {
  await ensureBalanceRow(db, app.id);
  const row = await db.query.sponsorBalances.findFirst({
    where: eq(sponsorBalances.appId, app.id),
  });
  const spent = await solanaSpentTodayLamports(db, app.id, now);
  return SponsorBalance.parse({
    balanceCents: row?.balanceCents ?? 0,
    solanaSpentTodayLamports: spent.toString(),
    solanaDailyCapLamports: AppConfig.parse(app.config).gasSponsoring.solanaDailyCapLamports,
  });
}

/* Solana fee payer (one per app, in a system sub-organization) */

export interface FeePayerDeps {
  db: Db;
  keyProvider: KeyProvider;
}

async function findFeePayer(db: Db, appId: string): Promise<AppSystemWalletRow | undefined> {
  return db.query.appSystemWallets.findFirst({
    where: and(eq(appSystemWallets.appId, appId), eq(appSystemWallets.purpose, 'solana_fee_payer')),
  });
}

/**
 * Reads the app fee payer or creates it. Two concurrent first calls may both create
 * a provider wallet: the unique (app, purpose) index keeps one, the other stays
 * unused at the provider (it never receives funds).
 */
export async function ensureSolanaFeePayer(
  deps: FeePayerDeps,
  app: AppRow,
): Promise<AppSystemWalletRow> {
  const existing = await findFeePayer(deps.db, app.id);
  if (existing) return existing;

  // A system sub-organization owned by the Pocketkey signer only: the app's gas
  // money, never a user key.
  const { subOrgId, account } = await deps.keyProvider
    .createSystemAccount({ name: `fee-payer-${app.id}`, chainFamily: 'solana' })
    .catch(providerFailure);

  await deps.db
    .insert(appSystemWallets)
    .values({
      id: newId('swl'),
      appId: app.id,
      purpose: 'solana_fee_payer',
      keyProviderSubOrgId: subOrgId,
      keyProviderWalletId: account.walletId,
      address: account.address,
    })
    .onConflictDoNothing();

  const stored = await findFeePayer(deps.db, app.id);
  if (!stored) throw new ApiError('internal', 'Could not store the sponsor fee payer');
  return stored;
}

/* Charges and refunds */

export interface SponsorCharge {
  appId: string;
  cents: number;
  reference: string;
}

/**
 * Debits the prepaid balance, never below zero. Insufficient balance is a 402 and
 * nothing is written. The ledger row follows; if it cannot be written the debit is
 * reverted so the balance and the ledger stay in agreement.
 */
export async function charge(
  db: Db,
  app: AppRow,
  input: { cents: number; reference: string; meta: Record<string, unknown> },
): Promise<SponsorCharge> {
  const { cents, reference } = input;
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new ApiError('internal', 'Invalid sponsor charge amount');
  }

  const debited = await db
    .update(sponsorBalances)
    .set({ balanceCents: sql`${sponsorBalances.balanceCents} - ${cents}`, updatedAt: new Date() })
    .where(and(eq(sponsorBalances.appId, app.id), gte(sponsorBalances.balanceCents, cents)))
    .returning({ balanceCents: sponsorBalances.balanceCents });
  if (debited.length === 0) {
    throw new ApiError(
      'insufficient_sponsor_balance',
      'The gas sponsoring balance of this app is too low, top it up to continue',
      { requiredCents: cents },
    );
  }

  try {
    await db.insert(sponsorLedger).values({
      id: newId('led'),
      appId: app.id,
      kind: 'charge',
      amountCents: -cents,
      reference,
      meta: input.meta,
    });
  } catch (error) {
    await db
      .update(sponsorBalances)
      .set({ balanceCents: sql`${sponsorBalances.balanceCents} + ${cents}`, updatedAt: new Date() })
      .where(eq(sponsorBalances.appId, app.id));
    throw error;
  }
  return { appId: app.id, cents, reference };
}

/**
 * Gives back part or all of a charge. The ledger row is written first with the unique
 * reference `refund:<charge reference>`, so a second refund of the same charge is a
 * no-op and a refund never credits more than once. Returns whether it credited.
 */
export async function refund(
  db: Db,
  app: AppRow,
  original: SponsorCharge,
  cents: number,
  reason: string,
): Promise<boolean> {
  const amount = Math.min(cents, original.cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;

  const [entry] = await db
    .insert(sponsorLedger)
    .values({
      id: newId('led'),
      appId: app.id,
      kind: 'refund',
      amountCents: amount,
      reference: `refund:${original.reference}`,
      meta: { reason, chargedCents: original.cents },
    })
    .onConflictDoNothing()
    .returning({ id: sponsorLedger.id });
  if (!entry) return false;

  await db
    .update(sponsorBalances)
    .set({ balanceCents: sql`${sponsorBalances.balanceCents} + ${amount}`, updatedAt: new Date() })
    .where(eq(sponsorBalances.appId, app.id));
  return true;
}

/** Refund that logs instead of throwing, for failure paths that already have an error. */
export async function refundQuietly(
  db: Db,
  app: AppRow,
  original: SponsorCharge,
  cents: number,
  reason: string,
): Promise<void> {
  try {
    await refund(db, app, original, cents, reason);
  } catch (error) {
    console.error(`[sponsor] refund of ${original.reference} failed`, error);
  }
}

/* Top-ups (payment webhooks) */

export type TopUpResult = 'credited' | 'duplicate' | 'unknown_app';

/**
 * Credits a completed top-up exactly once. The processed event, the balance and the
 * ledger row are written in one D1 batch (a transaction): an event is never marked
 * processed without its credit. A replay finds the event and does nothing; a
 * concurrent replay fails the batch on the event primary key and is reported as a
 * duplicate once the event is visible.
 */
export async function creditTopUp(
  db: Db,
  event: Extract<PaymentEvent, { type: 'topup.completed' }>,
): Promise<TopUpResult> {
  const processed = () =>
    db.query.paymentEvents.findFirst({ where: eq(paymentEvents.id, event.eventId) });
  if (await processed()) return 'duplicate';

  const app = await db.query.apps.findFirst({ where: eq(apps.id, event.appId) });
  if (!app) return 'unknown_app';

  const now = new Date();
  try {
    await db.batch([
      db.insert(paymentEvents).values({ id: event.eventId, type: event.type, processedAt: now }),
      db
        .insert(sponsorBalances)
        .values({ appId: app.id, balanceCents: event.amountCents, updatedAt: now })
        .onConflictDoUpdate({
          target: sponsorBalances.appId,
          set: {
            balanceCents: sql`${sponsorBalances.balanceCents} + ${event.amountCents}`,
            updatedAt: now,
          },
        }),
      db.insert(sponsorLedger).values({
        id: newId('led'),
        appId: app.id,
        kind: 'topup',
        amountCents: event.amountCents,
        reference: event.eventId,
        meta: { checkoutId: event.checkoutId },
      }),
    ]);
  } catch (error) {
    if (await processed()) return 'duplicate';
    throw error;
  }
  return 'credited';
}
