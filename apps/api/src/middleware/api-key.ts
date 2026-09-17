import { apiKeys, sha256Hex } from '@pocketkey/db';
import { SecretApiKey } from '@pocketkey/types';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { enforceRateLimit } from './rate-limit.js';

/** `last_used_at` is written at most once per this interval per key. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * `/v1/server/*` routes (section 7.2). Requires `requireApp` first: the secret
 * key must belong to the app named in `X-Pocketkey-App-Id`. Keys are stored as
 * SHA-256 only. Sets `apiKeyId`.
 */
export const requireApiKey = createMiddleware<AppEnv>(async (c, next) => {
  // Secret keys are server to server only. A browser Origin means the key leaked
  // into client code, so refuse even if the key itself is valid.
  if (c.req.header('Origin')) {
    throw new ApiError('forbidden', 'Secret API keys cannot be used from a browser');
  }

  const header = c.req.header('Authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const parsed = SecretApiKey.safeParse(match?.[1]);
  if (!parsed.success) throw new ApiError('api_key_invalid', 'Missing or malformed secret API key');

  const hash = await sha256Hex(parsed.data);
  const key = await c.var.db.query.apiKeys.findFirst({ where: eq(apiKeys.hash, hash) });
  // Unknown, revoked and other-app keys look the same from outside.
  if (key?.revokedAt !== null || key.appId !== c.var.app.id) {
    throw new ApiError('api_key_invalid', 'Invalid secret API key');
  }

  const now = new Date();
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    // Conditional, so concurrent requests write at most once per interval.
    await c.var.db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKeys.id, key.id),
          or(
            isNull(apiKeys.lastUsedAt),
            lt(apiKeys.lastUsedAt, new Date(now.getTime() - LAST_USED_RESOLUTION_MS)),
          ),
        ),
      );
  }

  c.set('apiKeyId', key.id);
  // T5.5, section 8.1: a stolen secret key is capped per key, not per app, so
  // revoking it is enough and the other keys of the app keep their budget.
  await enforceRateLimit(c, 'serverKey', key.id);
  await next();
});
