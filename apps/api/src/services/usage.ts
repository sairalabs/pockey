import { usageEvents, usageMonthly, type Db } from '@pockey/db';
import { and, count, countDistinct, eq, gte, lt } from 'drizzle-orm';

/**
 * Usage aggregation (T2.5, section 7.6). `usage_events` is append-only; this
 * folds it into `usage_monthly` per (app, month). It recomputes whole months,
 * so running it twice, late, or concurrently gives the same result.
 * The cron runs hourly. The previous month is recomputed too, so events that
 * land just before midnight on the last day are never lost.
 */

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(year: number, monthIndex: number): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end, key: monthKey(start) };
}

interface MonthTotals {
  activeUsers: number;
  walletsCreated: number;
  txSigned: number;
  sessionSigned: number;
  gasSponsoredWei: bigint;
  gasSponsoredLamports: bigint;
}

const empty = (): MonthTotals => ({
  activeUsers: 0,
  walletsCreated: 0,
  txSigned: 0,
  sessionSigned: 0,
  gasSponsoredWei: 0n,
  gasSponsoredLamports: 0n,
});

async function aggregateMonth(
  db: Db,
  start: Date,
  end: Date,
  key: string,
  now: Date,
): Promise<number> {
  const inMonth = and(gte(usageEvents.createdAt, start), lt(usageEvents.createdAt, end));

  const grouped = await db
    .select({
      appId: usageEvents.appId,
      type: usageEvents.type,
      events: count(),
      users: countDistinct(usageEvents.endUserId),
    })
    .from(usageEvents)
    .where(inMonth)
    .groupBy(usageEvents.appId, usageEvents.type);

  const totals = new Map<string, MonthTotals>();
  const totalsFor = (appId: string) => {
    let entry = totals.get(appId);
    if (!entry) {
      entry = empty();
      totals.set(appId, entry);
    }
    return entry;
  };

  for (const row of grouped) {
    const entry = totalsFor(row.appId);
    if (row.type === 'user.active') entry.activeUsers = row.users;
    if (row.type === 'wallet.created') entry.walletsCreated = row.events;
    if (row.type === 'tx.signed') entry.txSigned = row.events;
    if (row.type === 'session.signed') entry.sessionSigned = row.events;
  }

  // Gas amounts can exceed SQLite's 64-bit integers once summed, so add them as BigInt.
  const sponsored = await db
    .select({ appId: usageEvents.appId, amount: usageEvents.amount, meta: usageEvents.meta })
    .from(usageEvents)
    .where(and(inMonth, eq(usageEvents.type, 'tx.sponsored')));
  for (const row of sponsored) {
    if (!row.amount || !/^\d+$/.test(row.amount)) continue;
    const entry = totalsFor(row.appId);
    if (row.meta?.chain === 'solana') entry.gasSponsoredLamports += BigInt(row.amount);
    else entry.gasSponsoredWei += BigInt(row.amount);
  }

  for (const [appId, entry] of totals) {
    const values = {
      activeUsers: entry.activeUsers,
      walletsCreated: entry.walletsCreated,
      txSigned: entry.txSigned,
      sessionSigned: entry.sessionSigned,
      gasSponsoredWei: entry.gasSponsoredWei.toString(),
      gasSponsoredLamports: entry.gasSponsoredLamports.toString(),
      updatedAt: now,
    };
    await db
      .insert(usageMonthly)
      .values({ appId, month: key, ...values })
      .onConflictDoUpdate({ target: [usageMonthly.appId, usageMonthly.month], set: values });
  }
  return totals.size;
}

export async function aggregateUsage(
  db: Db,
  now = new Date(),
): Promise<{ months: string[]; rows: number }> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const targets = [monthBounds(year, month - 1), monthBounds(year, month)];
  let rows = 0;
  for (const target of targets)
    rows += await aggregateMonth(db, target.start, target.end, target.key, now);
  return { months: targets.map((target) => target.key), rows };
}
