import {
  consumeWindow,
  RateLimitDecision,
  type RateLimitRequest,
  type WindowState,
} from './protocol.js';

/** Anything that can count a request: the Durable Object, or a test double. */
export interface RateLimiterClient {
  consume(input: RateLimitRequest): Promise<RateLimitDecision>;
}

/**
 * Minimal shape of the `RATE_LIMITER` binding. Structural on purpose: the
 * generated `DurableObjectNamespace<RateLimiter>` fits it without `src/env.ts`
 * having to import the Durable Object class.
 */
export interface RateLimiterNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

/** Any absolute URL works: the request never leaves the object. */
const RATE_LIMITER_URL = 'https://rate-limiter.pockey.internal/consume';

export function createDurableRateLimiter(namespace: RateLimiterNamespace): RateLimiterClient {
  return {
    async consume(input) {
      const stub = namespace.get(namespace.idFromName(input.key));
      const response = await stub.fetch(
        new Request(RATE_LIMITER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        throw new Error(`Rate limiter answered ${String(response.status)}`);
      }
      return RateLimitDecision.parse(await response.json());
    },
  };
}

/** In-memory limiter with a clock the caller drives. Tests only. */
export interface MemoryRateLimiter extends RateLimiterClient {
  /** Moves the clock forward, so a window can be closed without waiting. */
  advance(milliseconds: number): void;
  now(): number;
  /** Drops every counter. */
  reset(): void;
}

export function createMemoryRateLimiter(options: { now?: number } = {}): MemoryRateLimiter {
  let clock = options.now ?? Date.now();
  const windows = new Map<string, WindowState>();
  return {
    async consume(input) {
      const { decision, state } = consumeWindow(windows.get(input.key), input, clock);
      if (state !== null) windows.set(input.key, state);
      return decision;
    },
    advance(milliseconds) {
      clock += milliseconds;
    },
    now() {
      return clock;
    },
    reset() {
      windows.clear();
    },
  };
}
