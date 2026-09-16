import { createDb } from '@pocketkey/db';
import { createApp } from './app.js';
import type { Env } from './env.js';
import { aggregateUsage } from './services/usage.js';

const app = createApp();

export default {
  fetch: app.fetch,

  /** Hourly cron (wrangler.jsonc `triggers.crons`): folds usage events into monthly totals. */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(aggregateUsage(createDb(env.DB)));
  },
} satisfies ExportedHandler<Env>;
