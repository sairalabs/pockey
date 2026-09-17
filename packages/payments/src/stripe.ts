import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  assertEnsureCustomerInput,
  assertEnsureSubscriptionInput,
  assertMeterEvent,
  assertPortalInput,
  billingPortalForm,
  customerForm,
  isHttpUrl,
  meterEventForm,
  readCustomer,
  readSubscription,
  usageSubscriptionForm,
} from './billing.js';
import { PaymentsError } from './errors.js';
import { sha256, toHex } from './sha256.js';
import type { BillingSubscription, Payments, TopUpCheckoutRequest } from './types.js';
import { DEFAULT_TOLERANCE_SECONDS, verifyStripeWebhook } from './webhook.js';

export const STRIPE_CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
export const STRIPE_CUSTOMERS_URL = 'https://api.stripe.com/v1/customers';
export const STRIPE_SUBSCRIPTIONS_URL = 'https://api.stripe.com/v1/subscriptions';
export const STRIPE_METER_EVENTS_URL = 'https://api.stripe.com/v1/billing/meter_events';
export const STRIPE_BILLING_PORTAL_SESSIONS_URL =
  'https://api.stripe.com/v1/billing_portal/sessions';
export const TOP_UP_PRODUCT_NAME = 'Pocketkey gas sponsoring credit';

const encoder = new TextEncoder();

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

interface StripeResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Stable `Idempotency-Key` for a create call. Hashed, so no developer id, customer
 * id or meter identifier ever reaches a Stripe header in clear text.
 */
export function stripeIdempotencyKey(scope: string, value: string): string {
  return `pocketkey-${scope}-${toHex(sha256(encoder.encode(`${scope}:${value}`)))}`;
}

/** The status is returned as is: the 404 and deleted cases drive the create fallbacks. */
async function callStripe(
  fetchImpl: typeof fetch,
  secretKey: string,
  init: { method: 'GET' | 'POST'; url: string; form?: URLSearchParams; idempotencyKey?: string },
): Promise<StripeResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
  if (init.form !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (init.idempotencyKey !== undefined) headers['Idempotency-Key'] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetchImpl(init.url, {
      method: init.method,
      headers,
      ...(init.form === undefined ? {} : { body: init.form.toString() }),
    });
  } catch (cause) {
    throw new PaymentsError('provider_error', 'Stripe request failed', { cause });
  }
  const body: unknown = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/** Stripe error text only, the secret key is never part of it. */
function rejected(what: string, res: StripeResponse): PaymentsError {
  return new PaymentsError(
    'provider_error',
    `Stripe rejected ${what} (${res.status}): ${stripeErrorMessage(res.body)}`,
    { status: res.status },
  );
}

function unexpected(what: string, res: StripeResponse): PaymentsError {
  return new PaymentsError('provider_error', `Stripe returned an unexpected ${what}`, {
    status: res.status,
  });
}

function requireOption(value: string | undefined, name: string, why: string): string {
  if (value === undefined || value.length === 0) {
    throw new PaymentsError('provider_error', `createStripePayments needs ${name} to ${why}`);
  }
  return value;
}

export interface StripePaymentsOptions {
  secretKey: string;
  webhookSecret: string;
  /** Metered price of the usage based plan, required by the subscription methods. */
  activeWalletPriceId?: string;
  /** `event_name` of the billing meter, required by `recordActiveWallets`. */
  activeWalletMeterName?: string;
  fetch?: typeof fetch;
  toleranceSeconds?: number;
}

/** Stripe Checkout, billing and webhooks over plain fetch and WebCrypto (no SDK, runs on Workers). */
export function createStripePayments(options: StripePaymentsOptions): Payments {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const call = (init: Parameters<typeof callStripe>[2]) =>
    callStripe(fetchImpl, options.secretKey, init);

  async function createSubscription(
    input: { customerId: string; developerId?: string },
    priceId: string,
  ): Promise<BillingSubscription> {
    const res = await call({
      method: 'POST',
      url: STRIPE_SUBSCRIPTIONS_URL,
      form: usageSubscriptionForm({
        customerId: input.customerId,
        priceId,
        ...(input.developerId === undefined ? {} : { developerId: input.developerId }),
      }),
      idempotencyKey: stripeIdempotencyKey('subscription', input.customerId),
    });
    if (!res.ok) throw rejected('the subscription', res);
    const created = readSubscription(res.body);
    if (created === null) throw unexpected('subscription', res);
    return created;
  }

  return {
    async createTopUpCheckout(input) {
      assertTopUpRequest(input);
      const res = await call({
        method: 'POST',
        url: STRIPE_CHECKOUT_SESSIONS_URL,
        form: checkoutSessionForm(input),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!res.ok) throw rejected('the checkout', res);
      const body = res.body;
      if (!isRecord(body) || typeof body.id !== 'string' || typeof body.url !== 'string') {
        throw unexpected('checkout session', res);
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

    async ensureCustomer(input) {
      assertEnsureCustomerInput(input);
      if (input.existingCustomerId !== undefined && input.existingCustomerId.length > 0) {
        const res = await call({
          method: 'GET',
          url: `${STRIPE_CUSTOMERS_URL}/${encodeURIComponent(input.existingCustomerId)}`,
        });
        if (res.ok) {
          // A deleted customer keeps its id but can no longer be billed: create a new one.
          const existing = readCustomer(res.body);
          if (existing !== null) {
            return { customerId: existing.customerId, email: existing.email ?? input.email };
          }
        } else if (res.status !== 404) {
          throw rejected('the customer lookup', res);
        }
      }
      const res = await call({
        method: 'POST',
        url: STRIPE_CUSTOMERS_URL,
        form: customerForm(input),
        idempotencyKey: stripeIdempotencyKey('customer', input.developerId),
      });
      if (!res.ok) throw rejected('the customer', res);
      const created = readCustomer(res.body);
      if (created === null) throw unexpected('customer', res);
      return { customerId: created.customerId, email: created.email ?? input.email };
    },

    async ensureUsageSubscription(input) {
      const priceId = requireOption(
        options.activeWalletPriceId,
        'activeWalletPriceId',
        'manage the usage based subscription',
      );
      assertEnsureSubscriptionInput(input);
      if (input.existingSubscriptionId !== undefined && input.existingSubscriptionId.length > 0) {
        const res = await call({
          method: 'GET',
          url: `${STRIPE_SUBSCRIPTIONS_URL}/${encodeURIComponent(input.existingSubscriptionId)}`,
        });
        if (res.ok) {
          const existing = readSubscription(res.body);
          if (existing !== null && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
            return existing;
          }
          // Canceled, unpaid or incomplete: subscribe again rather than resurrect.
        } else if (res.status !== 404) {
          throw rejected('the subscription lookup', res);
        }
      }
      return createSubscription(input, priceId);
    },

    async recordActiveWallets(input) {
      const eventName = requireOption(
        options.activeWalletMeterName,
        'activeWalletMeterName',
        'report active wallets',
      );
      assertMeterEvent(input.customerId, input.event);
      const res = await call({
        method: 'POST',
        url: STRIPE_METER_EVENTS_URL,
        form: meterEventForm({ eventName, customerId: input.customerId, event: input.event }),
        idempotencyKey: stripeIdempotencyKey('meter-event', input.event.identifier),
      });
      if (!res.ok) throw rejected('the meter event', res);
    },

    async createBillingPortalSession(input) {
      assertPortalInput(input);
      const res = await call({
        method: 'POST',
        url: STRIPE_BILLING_PORTAL_SESSIONS_URL,
        form: billingPortalForm(input),
        idempotencyKey: crypto.randomUUID(),
      });
      if (!res.ok) throw rejected('the billing portal session', res);
      const body = res.body;
      if (!isRecord(body) || typeof body.url !== 'string' || body.url.length === 0) {
        throw unexpected('billing portal session', res);
      }
      return { url: body.url };
    },
  };
}
