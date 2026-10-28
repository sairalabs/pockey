import { z } from 'zod';

/**
 * Rate limits (stolen developer key, OTP phishing, gas
 * sponsoring abuse). One fixed window per scope and per key, one minute wide.
 *
 * This object is the documentation: every scope below is enforced somewhere in
 * `src/middleware/rate-limit.ts`. The `RATE_LIMITS` var overrides any of them.
 */
export const RATE_LIMIT_DEFAULTS = {
  /** Every `/v1/*` request, keyed by the public app id. */
  app: { limit: 600, windowSeconds: 60 },
  /** User authenticated routes, keyed by the end user id. */
  user: { limit: 120, windowSeconds: 60 },
  /** Expensive auth routes (OTP mail, SIWE nonce, sign-in), keyed by the app. */
  authApp: { limit: 30, windowSeconds: 60 },
  /** The same routes, keyed by the hashed identity (email, or device id). */
  authIdentity: { limit: 5, windowSeconds: 60 },
  /** `/v1/server/*`, keyed by the secret API key id. */
  serverKey: { limit: 300, windowSeconds: 60 },
  /** Sponsored sends, keyed by the end user id. */
  sponsoredSend: { limit: 10, windowSeconds: 60 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitScope = keyof typeof RATE_LIMIT_DEFAULTS;

const perWindow = z.number().int().nonnegative().max(1_000_000).optional();

/**
 * `RATE_LIMITS` var, a JSON object of scope to requests per window, for example
 * `{"authIdentity":10}`. `0` turns that scope off. Unknown keys are ignored.
 */
export const RateLimitOverrides = z.object({
  app: perWindow,
  user: perWindow,
  authApp: perWindow,
  authIdentity: perWindow,
  serverKey: perWindow,
  sponsoredSend: perWindow,
});
export type RateLimitOverrides = z.infer<typeof RateLimitOverrides>;

/** Default of the scope, unless the deployment overrode its limit. */
export function resolveRateLimit(
  scope: RateLimitScope,
  overrides: RateLimitOverrides,
): { limit: number; windowSeconds: number } {
  const fallback = RATE_LIMIT_DEFAULTS[scope];
  return { limit: overrides[scope] ?? fallback.limit, windowSeconds: fallback.windowSeconds };
}
