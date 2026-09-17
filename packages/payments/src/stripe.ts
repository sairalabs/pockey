import { PaymentsError } from './errors.js';
import type { Payments, TopUpCheckoutRequest } from './types.js';
import { DEFAULT_TOLERANCE_SECONDS, verifyStripeWebhook } from './webhook.js';

export const STRIPE_CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
export const TOP_UP_PRODUCT_NAME = 'Pocketkey gas sponsoring credit';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Shared by the Stripe and mock implementations. */
export function assertTopUpRequest(input: TopUpCheckoutRequest): void {
  if (typeof input.appId !== 'string' || input.appId.length === 0) {
    throw new PaymentsError('invalid_payload', 'appId is required');
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PaymentsError('invalid_payload', 'amountCents must be a positive integer');
  }
  if (!isHttpUrl(input.successUrl) || !isHttpUrl(input.cancelUrl)) {
    throw new PaymentsError('invalid_payload', 'successUrl and cancelUrl must be http(s) URLs');
  }
}

/** Form body of `POST /v1/checkout/sessions` for a top-up. */
export function checkoutSessionForm(input: TopUpCheckoutRequest): URLSearchParams {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
  form.set('line_items[0][price_data][product_data][name]', TOP_UP_PRODUCT_NAME);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', input.successUrl);
  form.set('cancel_url', input.cancelUrl);
  form.set('metadata[appId]', input.appId);
  form.set('metadata[amountCents]', String(input.amountCents));
  form.set('payment_intent_data[metadata][appId]', input.appId);
  if (input.customerEmail) form.set('customer_email', input.customerEmail);
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripeErrorMessage(body: unknown): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    return body.error.message.slice(0, 300);
  }
  return 'unknown error';
}

/** Stripe Checkout and webhooks over plain fetch and WebCrypto (no SDK, runs on Workers). */
export function createStripePayments(options: {
  secretKey: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  toleranceSeconds?: number;
}): Payments {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  return {
    async createTopUpCheckout(input) {
      assertTopUpRequest(input);
      let res: Response;
      try {
        res = await fetchImpl(STRIPE_CHECKOUT_SESSIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: checkoutSessionForm(input).toString(),
        });
      } catch (cause) {
        throw new PaymentsError('provider_error', 'Stripe request failed', { cause });
      }

      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // Stripe error text only, the secret key is never part of it.
        throw new PaymentsError(
          'provider_error',
          `Stripe rejected the checkout (${res.status}): ${stripeErrorMessage(body)}`,
          { status: res.status },
        );
      }
      if (!isRecord(body) || typeof body.id !== 'string' || typeof body.url !== 'string') {
        throw new PaymentsError(
          'provider_error',
          'Stripe returned an unexpected checkout session',
          {
            status: res.status,
          },
        );
      }
      return { checkoutId: body.id, url: body.url };
    },

    async parseWebhook(input) {
      return verifyStripeWebhook({
        payload: input.payload,
        signatureHeader: input.signatureHeader,
        secret: options.webhookSecret,
        now: input.now ?? Date.now(),
        toleranceSeconds,
      });
    },
  };
}
