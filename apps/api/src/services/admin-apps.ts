import { apiKeys, apps, endUsers, sponsorBalances, type AppRow, type Db } from '@pockey/db';
import { AdminApp, App, AppConfig, AppSlug } from '@pockey/types';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '../errors.js';
import { currentMonthTotals, currentMonthWindow, zeroMonth } from './admin-usage.js';

/**
 * App rows as the dashboard reads them: the app itself plus the
 * four numbers every list row shows, so `/admin/apps` needs no extra call.
 */

export function toApp(row: AppRow): App {
  return App.parse({
    id: row.id,
    publicId: row.publicId,
    developerId: row.developerId,
    name: row.name,
    slug: row.slug,
    allowedOrigins: row.allowedOrigins,
    config: AppConfig.parse(row.config),
    createdAt: row.createdAt.toISOString(),
  });
}

export async function toAdminApps(db: Db, rows: AppRow[], now = new Date()): Promise<AdminApp[]> {
  const ids = rows.map((row) => row.id);
  const month = currentMonthWindow(now).key;
  if (ids.length === 0) return [];

  const usage = await currentMonthTotals(db, ids, now);
  const keyRows = await db
    .select({ appId: apiKeys.appId, total: count() })
    .from(apiKeys)
    .where(and(inArray(apiKeys.appId, ids), isNull(apiKeys.revokedAt)))
    .groupBy(apiKeys.appId);
  const userRows = await db
    .select({ appId: endUsers.appId, total: count() })
    .from(endUsers)
    .where(inArray(endUsers.appId, ids))
    .groupBy(endUsers.appId);
  const balanceRows = await db
    .select()
    .from(sponsorBalances)
    .where(inArray(sponsorBalances.appId, ids));

  const keyCounts = new Map(keyRows.map((row) => [row.appId, row.total]));
  const userCounts = new Map(userRows.map((row) => [row.appId, row.total]));
  const balances = new Map(balanceRows.map((row) => [row.appId, row.balanceCents]));

  return rows.map((row) =>
    AdminApp.parse({
      app: toApp(row),
      usage: usage.get(row.id) ?? zeroMonth(month),
      sponsorBalanceCents: balances.get(row.id) ?? 0,
      apiKeyCount: keyCounts.get(row.id) ?? 0,
      endUserCount: userCounts.get(row.id) ?? 0,
    }),
  );
}

export async function toAdminApp(db: Db, row: AppRow, now = new Date()): Promise<AdminApp> {
  const [admin] = await toAdminApps(db, [row], now);
  if (!admin) throw new ApiError('internal', 'Could not read the app');
  return admin;
}

/* Slugs: unique per developer, derived from the name when none is given. */

/** `My Great App!` -> `my-great-app`. Falls back to `app` when nothing is left. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return AppSlug.safeParse(base).success ? base : 'app';
}

async function takenSlugs(db: Db, developerId: string, exceptAppId?: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: apps.id, slug: apps.slug })
    .from(apps)
    .where(eq(apps.developerId, developerId));
  return new Set(rows.filter((row) => row.id !== exceptAppId).map((row) => row.slug));
}

/** Appends `-2`, `-3`, ... until the slug is free for this developer. */
export async function uniqueSlug(
  db: Db,
  developerId: string,
  base: string,
  exceptAppId?: string,
): Promise<string> {
  const taken = await takenSlugs(db, developerId, exceptAppId);
  if (!taken.has(base)) return base;

  for (let index = 2; index < 1000; index++) {
    const suffix = `-${index}`;
    const head = base.slice(0, 40 - suffix.length).replace(/-+$/, '') || 'app';
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ApiError('conflict', 'Could not find a free slug for this app');
}

/** A slug the developer asked for explicitly: taken means 409, never a rename. */
export async function assertSlugFree(
  db: Db,
  developerId: string,
  slug: string,
  exceptAppId?: string,
): Promise<void> {
  const taken = await takenSlugs(db, developerId, exceptAppId);
  if (taken.has(slug)) {
    throw new ApiError('conflict', `Slug "${slug}" is already used by another of your apps`);
  }
}
