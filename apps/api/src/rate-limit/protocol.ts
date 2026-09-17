import { z } from 'zod';

/**
 * Wire contract of the `RateLimiter` Durable Object and the fixed window counter
 * behind it. The same pure function backs the Durable Object and the in-memory
 * limiter the test suite injects, so both behave identically.
 */

export const RateLimitRequest = z.object({
  /** Scope prefixed key. Also the Durable Object name, so one object per key. */
  key: z.string().min(1).max(512),
  limit: z.number().int().positive().max(1_000_000),
  windowSeconds: z.number().int().positive().max(86_400),
});
export type RateLimitRequest = z.infer<typeof RateLimitRequest>;

export const RateLimitDecision = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
  /** End of the current window, in milliseconds since the epoch. */
  resetAt: z.number().int().nonnegative(),
});
export type RateLimitDecision = z.infer<typeof RateLimitDecision>;

/** One counter, valid for the window that starts at `windowStart`. */
export interface WindowState {
  windowStart: number;
  count: number;
}

/**
 * Fixed window: the window of an instant is the same for every caller, so two
 * isolates counting the same key agree without any clock synchronisation.
 * `state` is null when nothing is stored yet or the stored window is over.
 */
export function consumeWindow(
  stored: WindowState | undefined,
  input: RateLimitRequest,
  now: number,
): { decision: RateLimitDecision; state: WindowState | null } {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const count = stored?.windowStart === windowStart ? stored.count : 0;

  if (count >= input.limit) {
    return { decision: { allowed: false, remaining: 0, resetAt }, state: null };
  }
  const state: WindowState = { windowStart, count: count + 1 };
  return {
    decision: { allowed: true, remaining: input.limit - state.count, resetAt },
    state,
  };
}
