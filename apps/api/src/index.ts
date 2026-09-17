import { createDb } from '@pocketkey/db';
import { createApp } from './app.js';
import { parseEnv, type Env } from './env.js';
import { getKeyProvider } from './lib/key-provider.js';
import { expireSessions } from './services/sessions.js';
import { aggregateUsage } from './services/usage.js';

const app = createApp();

export default {
  fetch: app.fetch,

  /**
   * Hourly cron (wrangler.jsonc `triggers.crons`): folds usage events into monthly
   * totals and deletes the provider policies of expired session signers.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = createDb(env.DB);
    ctx.waitUntil(
      Promise.all([
        aggregateUsage(db),
        expireSessions(db, getKeyProvider(parseEnv(env)), new Date()),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
