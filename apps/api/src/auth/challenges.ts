import { authChallenges, type AuthChallengeRow, type Db } from '@pocketkey/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

export type ChallengePurpose = AuthChallengeRow['purpose'];

export async function createChallenge(
  db: Db,
  input: {
    id: string;
    appId: string;
    purpose: ChallengePurpose;
    ttlSeconds: number;
    subject?: string;
    now?: number;
  },
): Promise<Date> {
  const expiresAt = new Date((input.now ?? Date.now()) + input.ttlSeconds * 1000);
  await db.insert(authChallenges).values({
    id: input.id,
    appId: input.appId,
    purpose: input.purpose,
    subject: input.subject ?? null,
    expiresAt,
  });
  return expiresAt;
}

/**
 * Marks a challenge consumed and returns it, or null when it does not exist,
 * belongs to another app or purpose, expired, or was already used.
 * A single conditional UPDATE, so concurrent callers cannot both win.
 */
export async function consumeChallenge(
  db: Db,
  input: { id: string; appId: string; purpose: ChallengePurpose; now?: number },
): Promise<AuthChallengeRow | null> {
  const now = new Date(input.now ?? Date.now());
  const [row] = await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authChallenges.id, input.id),
        eq(authChallenges.appId, input.appId),
        eq(authChallenges.purpose, input.purpose),
        isNull(authChallenges.consumedAt),
        gt(authChallenges.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

/** Read without consuming (OAuth state lookup: Better Auth consumes its own state). */
export async function findLiveChallenge(
  db: Db,
  input: { id: string; purpose: ChallengePurpose; now?: number },
): Promise<AuthChallengeRow | null> {
  const now = new Date(input.now ?? Date.now());
  const row = await db.query.authChallenges.findFirst({
    where: and(
      eq(authChallenges.id, input.id),
      eq(authChallenges.purpose, input.purpose),
      isNull(authChallenges.consumedAt),
      gt(authChallenges.expiresAt, now),
    ),
  });
  return row ?? null;
}
