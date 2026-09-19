import { DEVICE_ID_HEADER, PublicAppId } from '@pocketkey/types';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { RateLimitError } from '../errors.js';
import { sha256Hex } from '../lib/crypto.js';
import { createDurableRateLimiter, type RateLimiterClient } from '../rate-limit/client.js';
import { resolveRateLimit, type RateLimitScope } from '../rate-limit/limits.js';
import type { RateLimitDecision } from '../rate-limit/protocol.js';
import { APP_ID_HEADER } from './app.js';

/**
 * Rate limiting of T5.5. Counters live in the `RateLimiter` Durable Object; this
 * decides which key a request is counted against and turns a refusal into the
 * documented 429 (`rate_limited`, `Retry-After`, `details`).
 *
 * `/health`, `/webhooks/*` and `/admin/*` are never limited: the first two are
 * infrastructure and the dashboard is one human behind a session cookie.
 */

let injected: RateLimiterClient | null | undefined;

/**
 * Test hook. A limiter makes the suite count deterministically, `null` turns
 * limiting off, `undefined` restores the Durable Object.
 */
export function setRateLimiterForTests(value: RateLimiterClient | null | undefined): void {
  injected = value;
}

function limiterFor(c: Context<AppEnv>): RateLimiterClient | null {
  if (injected !== undefined) return injected;
  // The suite makes hundreds of calls per file; without this it would 429 on volume.
  if (c.var.config.ENVIRONMENT === 'test') return null;
  return createDurableRateLimiter(c.env.RATE_LIMITER);
}

/**
 * Counts one request against `scope:identifier` and throws 429 when the window
 * is full. A limiter that is unreachable lets the request through: losing a
 * limit for a few seconds beats losing the API.
 */
export async function enforceRateLimit(
  c: Context<AppEnv>,
  scope: RateLimitScope,
  identifier: string,
): Promise<void> {
  const limiter = limiterFor(c);
  if (limiter === null) return;

  const { limit, windowSeconds } = resolveRateLimit(scope, c.var.config.RATE_LIMITS);
  if (limit === 0) return;

  let decision: RateLimitDecision;
  try {
    decision = await limiter.consume({ key: `${scope}:${identifier}`, limit, windowSeconds });
  } catch (error) {
    console.error(`[rate-limit] ${scope} counter unavailable`, error);
    return;
  }
  if (decision.allowed) return;

  const seconds = Math.min(
    windowSeconds,
    Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000)),
  );
  throw new RateLimitError(seconds, {
    scope,
    limit,
    resetAt: new Date(decision.resetAt).toISOString(),
  });
}

function publicAppIdOf(c: Context<AppEnv>): string | null {
  const raw = c.req.header(APP_ID_HEADER);
  if (raw === undefined) return null;
  const parsed = PublicAppId.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Every `/v1/*` request, keyed by the app. Mounted before `requireApp`, so it
 * reads the header rather than the row: a flood of unknown ids costs no query.
 */
export const appRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const appId = publicAppIdOf(c);
  if (appId !== null) await enforceRateLimit(c, 'app', appId);
  await next();
});

/**
 * Routes that cost an email, a key provider call or a signature verification.
 */
const EXPENSIVE_AUTH_PATHS: readonly RegExp[] = [
  /^\/v1\/auth\/email\/(start|verify|login)$/,
  /^\/v1\/auth\/wallet\/(lookup|login)$/,
  /^\/v1\/auth\/passkey\/login$/,
  /^\/v1\/auth\/oauth\/exchange$/,
];

export function isExpensiveAuthPath(path: string): boolean {
  return EXPENSIVE_AUTH_PATHS.some((pattern) => pattern.test(path));
}

/** Bodies of the expensive auth routes that name an identity. */
const IdentityBody = z.object({ email: z.string().min(3).max(320) });

/**
 * Who is being brute forced: the email when the body has one, otherwise the
 * device id the iframe generates. Cloning is what the auth routes already do,
 * so the handler still reads its own body.
 */
async function identityOf(c: Context<AppEnv>): Promise<string | null> {
  const body: unknown = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const parsed = IdentityBody.safeParse(body);
  if (parsed.success) return `email:${parsed.data.email.trim().toLowerCase()}`;
  const device = c.req.header(DEVICE_ID_HEADER);
  return device === undefined ? null : `device:${device}`;
}

/**
 * Mounted on `/v1/auth/*`, active only on the expensive routes. Two windows: one
 * per app, one per identity, so one email being hammered never locks the app out
 * for everybody else. The identity is hashed, so no address reaches a key.
 */
export const authRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!isExpensiveAuthPath(c.req.path)) {
    await next();
    return;
  }
  const appId = publicAppIdOf(c);
  if (appId !== null) await enforceRateLimit(c, 'authApp', appId);

  const identity = await identityOf(c);
  if (identity !== null) {
    const hashed = await sha256Hex(`${appId ?? 'unknown'}|${identity}`);
    await enforceRateLimit(c, 'authIdentity', hashed);
  }
  await next();
});
