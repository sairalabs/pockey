import {
  baAccount,
  baPasskey,
  baUser,
  endUserIdentities,
  endUsers,
  newId,
  usageEvents,
  wallets,
  type AppRow,
  type Db,
} from '@pocketkey/db';
import { EndUser, EndUserId, type ChainFamily, type IdentityType } from '@pocketkey/types';
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import { toBase64Url } from '../lib/crypto.js';

/**
 * Maps authentication results to Pocketkey end users (section 4.2).
 * One end user per app per person. Better Auth users map 1:1 through
 * `end_users.auth_user_id`; wallet-only users are found by their identity.
 */

export interface ResolvedEndUser {
  endUserId: string;
  isNewUser: boolean;
}

interface IdentityInput {
  type: IdentityType;
  identifier: string;
  verifiedAt: Date | null;
}

async function upsertIdentities(
  db: Db,
  app: AppRow,
  endUserId: string,
  identities: IdentityInput[],
) {
  for (const identity of identities) {
    await db
      .insert(endUserIdentities)
      .values({
        id: newId('idn'),
        endUserId,
        appId: app.id,
        type: identity.type,
        identifier: identity.identifier,
        verifiedAt: identity.verifiedAt,
      })
      .onConflictDoNothing();
  }
}

/** Records `user.active` once per UTC month and bumps `last_active_at` (section 7.6). */
export async function markActive(
  db: Db,
  app: AppRow,
  endUserId: string,
  now = new Date(),
): Promise<void> {
  const user = await db.query.endUsers.findFirst({ where: eq(endUsers.id, endUserId) });
  if (!user) return;
  const monthOf = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const firstThisMonth = !user.lastActiveAt || monthOf(user.lastActiveAt) !== monthOf(now);

  await db.update(endUsers).set({ lastActiveAt: now }).where(eq(endUsers.id, endUserId));
  if (firstThisMonth) {
    await db.insert(usageEvents).values({
      id: newId('evt'),
      appId: app.id,
      endUserId,
      type: 'user.active',
    });
  }
}

/** After an email OTP, OAuth or passkey login handled by Better Auth. */
export async function resolveFromAuthUser(
  db: Db,
  app: AppRow,
  authUserId: string,
): Promise<ResolvedEndUser> {
  const authUser = await db.query.baUser.findFirst({
    where: and(eq(baUser.id, authUserId), eq(baUser.appId, app.id)),
  });
  // Defense in depth: the tenant adapter already scopes users, recheck anyway.
  if (!authUser) throw new ApiError('unauthorized', 'Session does not belong to this app');

  let isNewUser = false;
  let endUser = await db.query.endUsers.findFirst({ where: eq(endUsers.authUserId, authUserId) });
  if (!endUser) {
    const id = newId('usr');
    const [created] = await db
      .insert(endUsers)
      .values({ id, appId: app.id, authUserId })
      .onConflictDoNothing()
      .returning();
    // A concurrent login may have created it first; read it back in that case.
    endUser =
      created ??
      (await db.query.endUsers.findFirst({ where: eq(endUsers.authUserId, authUserId) }));
    isNewUser = Boolean(created);
  }
  if (!endUser) throw new ApiError('internal', 'Could not create end user');

  const identities: IdentityInput[] = [
    {
      type: 'email',
      identifier: authUser.email.toLowerCase(),
      verifiedAt: authUser.emailVerified ? authUser.updatedAt : null,
    },
  ];

  const accounts = await db.select().from(baAccount).where(eq(baAccount.userId, authUserId));
  for (const account of accounts) {
    if (account.providerId === 'google' || account.providerId === 'apple') {
      identities.push({
        type: account.providerId,
        identifier: account.accountId,
        verifiedAt: account.createdAt,
      });
    }
  }

  const passkeys = await db.select().from(baPasskey).where(eq(baPasskey.userId, authUserId));
  for (const key of passkeys) {
    identities.push({ type: 'passkey', identifier: key.credentialID, verifiedAt: key.createdAt });
  }

  await upsertIdentities(db, app, endUser.id, identities);
  return { endUserId: endUser.id, isNewUser };
}

/** After a SIWE or SIWS login. EVM addresses are stored lowercase. */
export async function resolveFromWallet(
  db: Db,
  app: AppRow,
  chainFamily: ChainFamily,
  address: string,
): Promise<ResolvedEndUser> {
  const identifier = `${chainFamily}:${chainFamily === 'evm' ? address.toLowerCase() : address}`;
  const existing = await db.query.endUserIdentities.findFirst({
    where: and(
      eq(endUserIdentities.appId, app.id),
      eq(endUserIdentities.type, 'wallet'),
      eq(endUserIdentities.identifier, identifier),
    ),
  });
  if (existing) return { endUserId: existing.endUserId, isNewUser: false };

  const endUserId = newId('usr');
  await db.insert(endUsers).values({ id: endUserId, appId: app.id });
  const [identity] = await db
    .insert(endUserIdentities)
    .values({
      id: newId('idn'),
      endUserId,
      appId: app.id,
      type: 'wallet',
      identifier,
      verifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (!identity) {
    // Lost a race with a concurrent first login of the same wallet.
    await db.delete(endUsers).where(eq(endUsers.id, endUserId));
    const winner = await db.query.endUserIdentities.findFirst({
      where: and(
        eq(endUserIdentities.appId, app.id),
        eq(endUserIdentities.type, 'wallet'),
        eq(endUserIdentities.identifier, identifier),
      ),
    });
    if (!winner) throw new ApiError('internal', 'Could not resolve wallet user');
    return { endUserId: winner.endUserId, isNewUser: false };
  }
  return { endUserId, isNewUser: true };
}

/** Full public shape of `GET /v1/me` and of every login response. */
export async function loadEndUser(db: Db, app: AppRow, endUserId: string): Promise<EndUser> {
  const user = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.id, endUserId), eq(endUsers.appId, app.id)),
  });
  if (!user) throw new ApiError('not_found', 'End user not found');

  const identities = await db
    .select()
    .from(endUserIdentities)
    .where(eq(endUserIdentities.endUserId, endUserId));
  const userWallets = await db.select().from(wallets).where(eq(wallets.endUserId, endUserId));

  return EndUser.parse({
    id: user.id,
    appId: user.appId,
    identities: identities.map((identity) => ({
      id: identity.id,
      type: identity.type,
      identifier: identity.identifier,
      verifiedAt: identity.verifiedAt?.toISOString() ?? null,
    })),
    wallets: userWallets.map((wallet) => ({
      id: wallet.id,
      endUserId: wallet.endUserId,
      chainFamily: wallet.chainFamily,
      address: wallet.address,
      smartAccountAddress: wallet.smartAccountAddress,
      createdAt: wallet.createdAt.toISOString(),
    })),
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  });
}

/* Cursor pagination, shared by `/v1/server/users` and `/admin/apps/:id/users`. */

/** Opaque cursor: base64url JSON of the last (createdAt ms, id) returned. */
const CursorPayload = z.object({ t: z.number().int().nonnegative(), i: EndUserId });
type CursorPayload = z.infer<typeof CursorPayload>;

export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = CursorPayload.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Query of both listing routes. An unreadable cursor is a validation error. */
export const EndUserListQuery = z.object({
  cursor: z
    .string()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      const decoded = decodeCursor(value);
      if (!decoded) {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
        return z.NEVER;
      }
      return decoded;
    }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type EndUserListQuery = z.infer<typeof EndUserListQuery>;

// `created_at` comes from `unixepoch('subsec') * 1000`, a REAL: round it so the
// cursor compares whole milliseconds exactly.
const createdAtMs = sql<number>`cast(round(${endUsers.createdAt}) as integer)`;

/** One page of end users, newest first. */
export async function listEndUsers(
  db: Db,
  app: AppRow,
  query: EndUserListQuery,
): Promise<{ users: EndUser[]; nextCursor: string | null }> {
  const { cursor, limit } = query;
  const scope = eq(endUsers.appId, app.id);
  const where = cursor
    ? and(
        scope,
        or(lt(createdAtMs, cursor.t), and(eq(createdAtMs, cursor.t), lt(endUsers.id, cursor.i))),
      )
    : scope;

  const rows = await db
    .select({ id: endUsers.id, createdAt: createdAtMs })
    .from(endUsers)
    .where(where)
    .orderBy(desc(createdAtMs), desc(endUsers.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ t: last.createdAt, i: last.id as EndUserId })
      : null;

  const users: EndUser[] = [];
  for (const row of page) users.push(await loadEndUser(db, app, row.id));
  return { users, nextCursor };
}

/** Total end users of an app, for the dashboard list header. */
export async function countEndUsers(db: Db, appId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(endUsers).where(eq(endUsers.appId, appId));
  return row?.total ?? 0;
}
