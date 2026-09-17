import { hmacSha256, toHex } from './sha256.js';
import { assertTopUpRequest } from './stripe.js';
import type { Payments } from './types.js';
import { DEFAULT_TOLERANCE_SECONDS, verifyStripeWebhook } from './webhook.js';

/** Public on purpose: the mock is for tests and local development only, never production. */
export const MOCK_WEBHOOK_SECRET = 'whsec_pocketkey_mock';

const encoder = new TextEncoder();

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
}

/**
 * In-memory stand-in for Stripe. Webhooks use the real Stripe format and
 * verification path with `MOCK_WEBHOOK_SECRET`, so tests exercise the same code.
 */
export function createMockPayments(options: { baseUrl?: string } = {}): Payments & {
  completedEvent(appId: string, amountCents: number): { payload: string; signatureHeader: string };
} {
  const baseUrl = (options.baseUrl ?? 'http://localhost:8787').replace(/\/+$/, '');

  return {
    async createTopUpCheckout(input) {
      assertTopUpRequest(input);
      const checkoutId = randomId('cs_mock_');
      return { checkoutId, url: `${baseUrl}/mock/checkout/${checkoutId}` };
    },

    async parseWebhook(input) {
      return verifyStripeWebhook({
        payload: input.payload,
        signatureHeader: input.signatureHeader,
        secret: MOCK_WEBHOOK_SECRET,
        now: input.now ?? Date.now(),
        toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      });
    },

    completedEvent(appId, amountCents) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        id: randomId('evt_mock_'),
        object: 'event',
        type: 'checkout.session.completed',
        created: timestamp,
        data: {
          object: {
            id: randomId('cs_mock_'),
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'paid',
            status: 'complete',
            currency: 'usd',
            amount_total: amountCents,
            metadata: { appId, amountCents: String(amountCents) },
          },
        },
      });
      const signature = toHex(
        hmacSha256(encoder.encode(MOCK_WEBHOOK_SECRET), encoder.encode(`${timestamp}.${payload}`)),
      );
      return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
    },
  };
}
