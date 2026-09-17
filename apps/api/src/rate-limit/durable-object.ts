import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';
import {
  consumeWindow,
  RateLimitRequest,
  type RateLimitDecision,
  type WindowState,
} from './protocol.js';

const STATE_KEY = 'window';

/**
 * One fixed window counter per key (T5.5). A Durable Object is the cheapest
 * strongly consistent counter on Workers, and `new_sqlite_classes` in
 * `wrangler.jsonc` keeps it available on the free plan.
 *
 * `POST { key, limit, windowSeconds }` answers `{ allowed, remaining, resetAt }`.
 * Storage is dropped by an alarm at the end of the window, so an object that is
 * never hit again costs nothing.
 */
export class RateLimiter extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const body: unknown = await request.json().catch(() => null);
    const parsed = RateLimitRequest.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'invalid_payload' }, { status: 400 });
    }
    return Response.json(await this.consume(parsed.data));
  }

  /** Counts one request. Exposed for direct calls from tests. */
  async consume(input: RateLimitRequest): Promise<RateLimitDecision> {
    const stored = await this.ctx.storage.get<WindowState>(STATE_KEY);
    const { decision, state } = consumeWindow(stored, input, Date.now());
    if (state !== null) {
      await this.ctx.storage.put(STATE_KEY, state);
      // Only when the window opens: one alarm write per window, not per request.
      if (state.count === 1) await this.ctx.storage.setAlarm(decision.resetAt);
    }
    return decision;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
