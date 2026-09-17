/**
 * Cron expressions of `triggers.crons` in `wrangler.jsonc`. `scheduled` switches
 * on `controller.cron`, so the two schedules must stay in sync with that file.
 */

/** Usage aggregation (T2.5) and expiry of session signer policies (T4.3). */
export const HOURLY_CRON = '0 * * * *';

/**
 * Stripe metering (section 7.6, T5.4). Late enough after midnight UTC that the
 * day it reports is closed everywhere, early enough to be far from the hourly run.
 */
export const DAILY_CRON = '20 2 * * *';
