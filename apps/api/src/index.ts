import { createDb } from '@pocketkey/db';
import { createApp } from './app.js';
import { DAILY_CRON } from './cron.js';
import { parseEnv, type Env } from './env.js';
import { getKeyProvider } from './lib/key-provider.js';
import { getPayments } from './lib/sponsor.js';
import { meterRecentDays } from './services/billing.js';
import { expireSessions } from './services/sessions.js';
import { aggregateUsage } from './services/usage.js';

/** Rate limiting of T5.5. Bound as `RATE_LIMITER` in `wrangler.jsonc`. */
export { RateLimiter } from './rate-limit/durable-object.js';

const app = createApp();

export default {
  fetch: app.fetch,

  /**
   * Two schedules (`triggers.crons`, `src/cron.ts`). Hourly folds usage events
   * into monthly totals and deletes the provider policies of expired session
   * signers; nightly reports monthly active wallets to Stripe (section 7.6).
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = parseEnv(env);
    const db = createDb(env.DB);

    switch (controller.cron) {
      case DAILY_CRON:
        ctx.waitUntil(meterRecentDays(db, getPayments(config), new Date(controller.scheduledTime)));
        break;
      default:
        ctx.waitUntil(
          Promise.all([aggregateUsage(db), expireSessions(db, getKeyProvider(config), new Date())]),
        );
        break;
    }
  },
} satisfies ExportedHandler<Env>;
