/**
 * Cron expressions of `triggers.crons` in `wrangler.jsonc`. `scheduled` switches
 * on `controller.cron`, so the two schedules must stay in sync with that file.
 */

/** Usage aggregation and expiry of session signer policies. */
export const HOURLY_CRON = '0 * * * *';

/**
 * Stripe metering. Late enough after midnight UTC that the
 * day it reports is closed everywhere, early enough to be far from the hourly run.
 */
export const DAILY_CRON = '20 2 * * *';
