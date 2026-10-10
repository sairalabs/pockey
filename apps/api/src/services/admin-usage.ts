import { endUserIdentities, usageEvents, usageMonthly, type Db } from '@pockey/db';
import {
  AdminUsage,
  LoginMethod,
  UsageMonthly,
  type UsagePoint,
  type UsageRange,
} from '@pockey/types';
import { and, count, countDistinct, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { monthKey } from './usage.js';

/**
 * Numbers behind the dashboard graphs (T5.3, section 7.6).
 *
 * `usage_monthly` is written by the hourly cron, so it always lags the current
 * month. Every current month figure here is recomputed live from `usage_events`
 * instead, and past months are read from `usage_monthly`: the dashboard and the
 * billing estimate then agree with what just happened, not with the last cron.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface Totals {
  activeUsers: number;
  walletsCreated: number;
  txSigned: number;
  sessionSigned: number;
  gasSponsoredWei: bigint;
  gasSponsoredLamports: bigint;
}

const emptyTotals = (): Totals => ({
  activeUsers: 0,
  walletsCreated: 0,
  txSigned: 0,
  sessionSigned: 0,
  gasSponsoredWei: 0n,
  gasSponsoredLamports: 0n,
});

function monthlyFrom(month: string, totals: Totals): UsageMonthly {
  return UsageMonthly.parse({
    month,
    activeUsers: totals.activeUsers,
    walletsCreated: totals.walletsCreated,
    txSigned: totals.txSigned,
    sessionSigned: totals.sessionSigned,
    gasSponsoredWei: totals.gasSponsoredWei.toString(),
    gasSponsoredLamports: totals.gasSponsoredLamports.toString(),
  });
}

function pointFrom(date: string, totals: Totals): UsagePoint {
  return {
    date,
    activeUsers: totals.activeUsers,
    walletsCreated: totals.walletsCreated,
    txSigned: totals.txSigned,
    sessionSigned: totals.sessionSigned,
    gasSponsoredWei: totals.gasSponsoredWei.toString(),
    gasSponsoredLamports: totals.gasSponsoredLamports.toString(),
  };
}

/** A month with no event at all. */
export function zeroMonth(month: string): UsageMonthly {
  return monthlyFrom(month, emptyTotals());
}

export function currentMonthWindow(now: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, key: monthKey(start) };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `created_at` is milliseconds; SQLite groups on the UTC calendar day. */
const dayExpression = sql<string>`strftime('%Y-%m-%d', cast(${usageEvents.createdAt} / 1000 as integer), 'unixepoch')`;

function addEvents(entry: Totals, type: string, events: number, users: number): void {
  if (type === 'user.active') entry.activeUsers = users;
  if (type === 'wallet.created') entry.walletsCreated = events;
  if (type === 'tx.signed') entry.txSigned = events;
  if (type === 'session.signed') entry.sessionSigned = events;
}

function addGas(entry: Totals, amount: string | null, meta: Record<string, unknown> | null): void {
  if (!amount || !/^\d+$/.test(amount)) return;
  // Gas sums exceed SQLite's 64-bit integers once aggregated, so add them as BigInt.
  if (meta?.chain === 'solana') entry.gasSponsoredLamports += BigInt(amount);
  else entry.gasSponsoredWei += BigInt(amount);
}

function getOrCreate(totals: Map<string, Totals>, key: string): Totals {
  let entry = totals.get(key);
  if (!entry) {
    entry = emptyTotals();
    totals.set(key, entry);
  }
  return entry;
}

/** Totals per app over a window, from the append-only event log. */
async function totalsByApp(
  db: Db,
  appIds: string[],
  start: Date,
  end: Date,
): Promise<Map<string, Totals>> {
  const totals = new Map<string, Totals>();
  if (appIds.length === 0) return totals;

  const within = and(
    inArray(usageEvents.appId, appIds),
    gte(usageEvents.createdAt, start),
    lt(usageEvents.createdAt, end),
  );

  const grouped = await db
    .select({
      appId: usageEvents.appId,
      type: usageEvents.type,
      events: count(),
      users: countDistinct(usageEvents.endUserId),
    })
    .from(usageEvents)
    .where(within)
    .groupBy(usageEvents.appId, usageEvents.type);
  for (const row of grouped) {
    addEvents(getOrCreate(totals, row.appId), row.type, row.events, row.users);
  }

  const sponsored = await db
    .select({ appId: usageEvents.appId, amount: usageEvents.amount, meta: usageEvents.meta })
    .from(usageEvents)
    .where(and(within, eq(usageEvents.type, 'tx.sponsored')));
  for (const row of sponsored) {
    addGas(getOrCreate(totals, row.appId), row.amount, row.meta);
  }
  return totals;
}

/** Current month, live, for every app given. Apps without events get zeros. */
export async function currentMonthTotals(
  db: Db,
  appIds: string[],
  now: Date,
): Promise<Map<string, UsageMonthly>> {
  const { start, end, key } = currentMonthWindow(now);
  const totals = await totalsByApp(db, appIds, start, end);
  const monthly = new Map<string, UsageMonthly>();
  for (const appId of appIds) {
    const entry = totals.get(appId);
    monthly.set(appId, entry ? monthlyFrom(key, entry) : zeroMonth(key));
  }
  return monthly;
}

/** Current month of one app, live. */
export async function currentMonth(db: Db, appId: string, now: Date): Promise<UsageMonthly> {
  const monthly = await currentMonthTotals(db, [appId], now);
  return monthly.get(appId) ?? zeroMonth(currentMonthWindow(now).key);
}

/** Totals per UTC day over a window, for one app. */
async function totalsByDay(
  db: Db,
  appId: string,
  start: Date,
  end: Date,
): Promise<Map<string, Totals>> {
  const totals = new Map<string, Totals>();
  const within = and(
    eq(usageEvents.appId, appId),
    gte(usageEvents.createdAt, start),
    lt(usageEvents.createdAt, end),
  );

  const grouped = await db
    .select({
      day: dayExpression,
      type: usageEvents.type,
      events: count(),
      users: countDistinct(usageEvents.endUserId),
    })
    .from(usageEvents)
    .where(within)
    .groupBy(dayExpression, usageEvents.type);
  for (const row of grouped) {
    addEvents(getOrCreate(totals, row.day), row.type, row.events, row.users);
  }

  const sponsored = await db
    .select({ day: dayExpression, amount: usageEvents.amount, meta: usageEvents.meta })
    .from(usageEvents)
    .where(and(within, eq(usageEvents.type, 'tx.sponsored')));
  for (const row of sponsored) {
    addGas(getOrCreate(totals, row.day), row.amount, row.meta);
  }
  return totals;
}

/** `7d` and `30d`: one point per UTC day, empty days filled with zeros. */
async function dailyPoints(db: Db, appId: string, days: number, now: Date): Promise<UsagePoint[]> {
  const today = startOfUtcDay(now);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);
  const end = new Date(today.getTime() + DAY_MS);
  const totals = await totalsByDay(db, appId, start, end);

  const points: UsagePoint[] = [];
  for (let index = 0; index < days; index++) {
    const date = dayKey(new Date(start.getTime() + index * DAY_MS));
    points.push(pointFrom(date, totals.get(date) ?? emptyTotals()));
  }
  return points;
}

/**
 * `12m`: one point per UTC month. Past months come from `usage_monthly`, the
 * current one from live events, so the last bar is never a cron behind.
 */
async function monthlyPoints(db: Db, appId: string, now: Date): Promise<UsagePoint[]> {
  const months: string[] = [];
  for (let back = 11; back >= 0; back--) {
    months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))));
  }
  const currentKey = currentMonthWindow(now).key;

  const stored = await db
    .select()
    .from(usageMonthly)
    .where(and(eq(usageMonthly.appId, appId), inArray(usageMonthly.month, months)));
  const byMonth = new Map(stored.map((row) => [row.month, row]));
  const live = await currentMonth(db, appId, now);

  return months.map((month): UsagePoint => {
    const row = month === currentKey ? live : byMonth.get(month);
    if (!row) return pointFrom(month, emptyTotals());
    return {
      date: month,
      activeUsers: row.activeUsers,
      walletsCreated: row.walletsCreated,
      txSigned: row.txSigned,
      sessionSigned: row.sessionSigned,
      gasSponsoredWei: row.gasSponsoredWei,
      gasSponsoredLamports: row.gasSponsoredLamports,
    };
  });
}

/** Distinct end users per identity type. Every method is listed, zeros included. */
async function loginMethods(
  db: Db,
  appId: string,
): Promise<{ method: LoginMethod; users: number }[]> {
  const rows = await db
    .select({ type: endUserIdentities.type, users: countDistinct(endUserIdentities.endUserId) })
    .from(endUserIdentities)
    .where(eq(endUserIdentities.appId, appId))
    .groupBy(endUserIdentities.type);
  const byType = new Map(rows.map((row) => [row.type, row.users]));
  return LoginMethod.options.map((method) => ({ method, users: byType.get(method) ?? 0 }));
}

/** `GET /admin/apps/:id/usage`. */
export async function adminUsage(
  db: Db,
  appId: string,
  range: UsageRange,
  now = new Date(),
): Promise<AdminUsage> {
  const points =
    range === '12m'
      ? await monthlyPoints(db, appId, now)
      : await dailyPoints(db, appId, range === '7d' ? 7 : 30, now);

  return AdminUsage.parse({
    range,
    points,
    month: await currentMonth(db, appId, now),
    loginMethods: await loginMethods(db, appId),
  });
}
