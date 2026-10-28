import { developers, newId, type Db, type DeveloperRow } from '@pockey/db';
import { Developer } from '@pockey/types';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors.js';

/**
 * Developer accounts behind the dashboard. A Better Auth user maps to one
 * `developers` row through `auth_user_id`. The row is created on first sign-in,
 * so nothing has to be provisioned by hand and the local seed stays untouched.
 */

export interface AuthUserLike {
  id: string;
  email: string;
  name?: string | null;
}

/** Finds the developer of a Better Auth user, linking or creating the row once. */
export async function ensureDeveloper(db: Db, authUser: AuthUserLike): Promise<DeveloperRow> {
  const byAuthUser = () =>
    db.query.developers.findFirst({ where: eq(developers.authUserId, authUser.id) });

  const existing = await byAuthUser();
  if (existing) return existing;

  const email = authUser.email.toLowerCase();
  const name = authUser.name && authUser.name.trim() !== '' ? authUser.name : null;

  // A row may predate the dashboard (local seed, support): claim it rather than
  // insert a second one, since `developers.email` is unique.
  await db
    .update(developers)
    .set({ authUserId: authUser.id })
    .where(and(eq(developers.email, email), isNull(developers.authUserId)));
  const linked = await byAuthUser();
  if (linked) return linked;

  const [created] = await db
    .insert(developers)
    .values({ id: newId('dev'), email, name, authUserId: authUser.id })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a concurrent first sign-in of the same developer.
  const raced = await byAuthUser();
  if (!raced) throw new ApiError('internal', 'Could not create the developer account');
  return raced;
}

/** Public shape of `GET /admin/session`. */
export function toDeveloper(row: DeveloperRow): Developer {
  return Developer.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    // Creates the Stripe customer; until then the portal cannot open.
    billingReady: row.stripeCustomerId !== null,
  });
}
