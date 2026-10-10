import { PaymentsError, type PaymentEvent } from '@pockey/payments';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { getPayments } from '../lib/sponsor.js';
import { creditTopUp } from '../services/sponsoring.js';

export const WebhookReceived = z.object({ received: z.literal(true) });

/** Stripe signs the raw body: nothing may parse or re-serialize it before verification. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Payment provider webhooks (T4.6). Mounted outside `/v1`: no app header, no CORS,
 * authenticated by the `Stripe-Signature` HMAC only.
 */
export const webhookRoutes = new Hono<AppEnv>().post('/stripe', async (c) => {
  const payload = await c.req.text();
  if (payload.length > MAX_WEBHOOK_BYTES) {
    throw new ApiError('bad_request', 'Webhook payload too large');
  }

  let event: PaymentEvent;
  try {
    event = await getPayments(c.var.config).parseWebhook({
      payload,
      signatureHeader: c.req.header('Stripe-Signature') ?? null,
    });
  } catch (error) {
    if (error instanceof PaymentsError) {
      throw new ApiError('bad_request', 'Invalid webhook', { reason: error.code });
    }
    throw error;
  }

  if (event.type === 'topup.completed') {
    const result = await creditTopUp(c.var.db, event);
    if (result === 'unknown_app') {
      // Acknowledge anyway: a retry cannot make the app exist, so Stripe must not loop.
      console.warn(
        `[webhooks] top-up ${event.eventId} for unknown app ${event.appId} (${event.amountCents} cents) ignored`,
      );
    }
  }
  return c.json(WebhookReceived.parse({ received: true }));
});
