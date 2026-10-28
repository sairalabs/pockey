import { newId, refreshTokens, type AppRow, type Db } from '@pockey/db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  type AuthTokens,
} from '@pockey/types';
import { and, eq, isNull } from 'drizzle-orm';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';
import type { ParsedEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { deriveKeyHex, randomBytes, sha256Hex, toBase64Url } from '../lib/crypto.js';

/**
 * Pockey sessions.
 * - Access: HS256 JWT, 15 minutes. Key derived from BETTER_AUTH_SECRET with HKDF,
 *   so no extra Wrangler secret is introduced.
 * - Refresh: opaque `pk_rt_<43 base64url>`, 30 days, SHA-256 in D1, one family per login.
 *   Using a rotated token again revokes the family (the token was stolen or replayed).
 */

const ISSUER = 'pockey';

export const AccessClaims = z.object({
  iss: z.literal(ISSUER),
  aud: z.string(),
  sub: z.string(),
  /** Internal app id, checked against the resolved app on every request. */
  app: z.string(),
  /** Refresh token family. Revoking the family invalidates the access token too. */
  sid: z.string(),
  iat: z.number(),
  exp: z.number(),
});
export type AccessClaims = z.infer<typeof AccessClaims>;

const keyCache = new Map<string, Promise<string>>();
function accessKey(config: ParsedEnv): Promise<string> {
  let key = keyCache.get(config.BETTER_AUTH_SECRET);
  if (!key) {
    key = deriveKeyHex(config.BETTER_AUTH_SECRET, 'pockey/access-token/v1');
    keyCache.set(config.BETTER_AUTH_SECRET, key);
  }
  return key;
}

function newRefreshToken(): string {
  return `pk_rt_${toBase64Url(randomBytes(32))}`;
}

async function signAccess(
  config: ParsedEnv,
  app: AppRow,
  endUserId: string,
  familyId: string,
  now: number,
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const claims: AccessClaims = {
    iss: ISSUER,
    aud: app.publicId,
    sub: endUserId,
    app: app.id,
    sid: familyId,
    iat,
    exp,
  };
  return {
    token: await sign(claims, await accessKey(config), 'HS256'),
    expiresAt: new Date(exp * 1000),
  };
}

export interface IssueInput {
  db: Db;
  config: ParsedEnv;
  app: AppRow;
  endUserId: string;
  userAgent?: string | undefined;
  /** Continue an existing family (rotation) instead of starting a new one. */
  familyId?: string;
  now?: number;
}

export async function issueTokens(input: IssueInput): Promise<AuthTokens> {
  const now = input.now ?? Date.now();
  const familyId = input.familyId ?? newId('ses');
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await input.db.insert(refreshTokens).values({
    id: newId('rtk'),
    endUserId: input.endUserId,
    appId: input.app.id,
    familyId,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: refreshExpiresAt,
    userAgent: input.userAgent?.slice(0, 256) ?? null,
  });

  const access = await signAccess(input.config, input.app, input.endUserId, familyId, now);
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export async function revokeFamily(db: Db, familyId: string, now = Date.now()): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(now) })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/**
 * Exchanges a refresh token for a new pair. Atomic: the rotation is a
 * conditional UPDATE, so two concurrent refreshes with the same token cannot
 * both succeed; the loser is treated as reuse and the family is revoked.
 */
export async function rotateRefreshToken(input: {
  db: Db;
  config: ParsedEnv;
  app: AppRow;
  refreshToken: string;
  userAgent?: string | undefined;
  now?: number;
}): Promise<{ tokens: AuthTokens; endUserId: string }> {
  const now = input.now ?? Date.now();
  const tokenHash = await sha256Hex(input.refreshToken);
  const row = await input.db.query.refreshTokens.findFirst({
    where: and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.appId, input.app.id)),
  });

  if (!row || row.revokedAt) throw new ApiError('session_expired', 'Refresh token is not valid');
  if (row.expiresAt.getTime() <= now)
    throw new ApiError('session_expired', 'Refresh token expired');

  if (row.rotatedAt) {
    await revokeFamily(input.db, row.familyId, now);
    throw new ApiError('session_expired', 'Refresh token was already used, session revoked');
  }

  const claimed = await input.db
    .update(refreshTokens)
    .set({ rotatedAt: new Date(now) })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.rotatedAt)))
    .returning({ id: refreshTokens.id });

  if (claimed.length !== 1) {
    await revokeFamily(input.db, row.familyId, now);
    throw new ApiError('session_expired', 'Refresh token was already used, session revoked');
  }

  const tokens = await issueTokens({
    db: input.db,
    config: input.config,
    app: input.app,
    endUserId: row.endUserId,
    familyId: row.familyId,
    userAgent: input.userAgent,
    now,
  });
  return { tokens, endUserId: row.endUserId };
}

export async function verifyAccessToken(input: {
  db: Db;
  config: ParsedEnv;
  app: AppRow;
  token: string;
}): Promise<AccessClaims> {
  let payload: unknown;
  try {
    payload = await verify(input.token, await accessKey(input.config), {
      alg: 'HS256',
      iss: ISSUER,
      aud: input.app.publicId,
    });
  } catch {
    throw new ApiError('session_expired', 'Access token is invalid or expired');
  }

  const claims = AccessClaims.safeParse(payload);
  if (!claims.success || claims.data.app !== input.app.id) {
    throw new ApiError('unauthorized', 'Access token does not belong to this app');
  }

  // Revocation takes effect immediately, not after the 15 minute expiry.
  const live = await input.db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.familyId, claims.data.sid), isNull(refreshTokens.revokedAt)))
    .limit(1);
  if (live.length === 0) throw new ApiError('session_expired', 'Session was revoked');

  return claims.data;
}
