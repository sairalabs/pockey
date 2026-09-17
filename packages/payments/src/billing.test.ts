import { FREE_MONTHLY_ACTIVE_WALLETS, PRICE_CENTS_PER_ACTIVE_WALLET } from '@pocketkey/types';
import { describe, expect, it, vi } from 'vitest';
import { estimateMonthlyCents } from './billing.js';
import { PaymentsError } from './errors.js';
import { createMockPayments, MOCK_ACTIVE_WALLET_METER_ID } from './mock.js';
import { toHex } from './sha256.js';
import {
  createStripePayments,
  stripeIdempotencyKey,
  STRIPE_BILLING_PORTAL_SESSIONS_URL,
  STRIPE_CUSTOMERS_URL,
  STRIPE_METER_EVENTS_URL,
  STRIPE_SUBSCRIPTIONS_URL,
} from './stripe.js';

const SECRET_KEY = 'sk_test_do_not_leak';
const WEBHOOK_SECRET = 'whsec_test_secret';
const PRICE_ID = 'price_active_wallets';
const METER_NAME = 'pocketkey_active_wallets';
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1000);
const encoder = new TextEncoder();

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  form: Record<string, string>;
}

function capture(): { requests: Captured[]; push: (url: string, init?: RequestInit) => void } {
  const requests: Captured[] = [];
  return {
    requests,
    push(url, init) {
      const form: Record<string, string> = {};
      new URLSearchParams(typeof init?.body === 'string' ? init.body : '').forEach((value, key) => {
        form[key] = value;
      });
      requests.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        form,
      });
    },
  };
}

/** Routes fake Stripe responses by method and URL prefix. */
function stripeWith(
  routes: { method: string; url: string; respond: () => Response }[],
  options?: { priceId?: string | undefined; meterName?: string | undefined },
) {
  const captured = capture();
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    captured.push(url, init);
    const method = init?.method ?? 'GET';
    const route = routes.find((candidate) => candidate.method === method && candidate.url === url);
    if (!route)
      return Response.json(
        { error: { message: `no route for ${method} ${url}` } },
        { status: 500 },
      );
    return route.respond();
  });
  const payments = createStripePayments({
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
    fetch: fetchMock,
    ...(options?.priceId === undefined ? {} : { activeWalletPriceId: options.priceId }),
    ...(options?.meterName === undefined ? {} : { activeWalletMeterName: options.meterName }),
  });
  return { payments, requests: captured.requests, fetchMock };
}

function billingStripe(routes: { method: string; url: string; respond: () => Response }[]) {
  return stripeWith(routes, { priceId: PRICE_ID, meterName: METER_NAME });
}

function customerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'cus_123', object: 'customer', email: 'dev@example.com', ...overrides };
}

function subscriptionBody(
  overrides: {
    id?: string;
    status?: string;
    currentPeriodEnd?: number | null;
    itemPeriodEnd?: number | null;
    meter?: string | null;
  } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: overrides.id ?? 'sub_123',
    object: 'subscription',
    status: overrides.status ?? 'active',
    items: {
      object: 'list',
      data: [
        {
          id: 'si_1',
          object: 'subscription_item',
          current_period_end: overrides.itemPeriodEnd ?? null,
          price: {
            id: PRICE_ID,
            object: 'price',
            recurring: {
              interval: 'month',
              usage_type: 'metered',
              meter: overrides.meter === undefined ? 'mtr_active_wallets' : overrides.meter,
            },
          },
        },
      ],
    },
  };
  if (overrides.currentPeriodEnd !== undefined && overrides.currentPeriodEnd !== null) {
    body.current_period_end = overrides.currentPeriodEnd;
  }
  return body;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentsError);
  return (error as PaymentsError).code;
}

async function errorOf(promise: Promise<unknown>): Promise<PaymentsError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentsError);
  return error as PaymentsError;
}

async function webCryptoHmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

async function signed(payload: string, secret = WEBHOOK_SECRET, timestamp = NOW_SECONDS) {
  return `t=${timestamp},v1=${await webCryptoHmacHex(secret, `${timestamp}.${payload}`)}`;
}

function eventPayload(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: 'evt_billing_1', object: 'event', type, data: { object } });
}

async function parseEvent(payload: string) {
  const payments = createStripePayments({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET });
  return payments.parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW });
}

describe('ensureCustomer', () => {
  it('creates a customer with metadata and an idempotency key derived from the developer', async () => {
    const { payments, requests } = billingStripe([
      { method: 'POST', url: STRIPE_CUSTOMERS_URL, respond: () => Response.json(customerBody()) },
    ]);

    await expect(
      payments.ensureCustomer({
        developerId: 'dev_1',
        email: 'dev@example.com',
        name: 'Jenny Rosen',
      }),
    ).resolves.toEqual({ customerId: 'cus_123', email: 'dev@example.com' });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe(STRIPE_CUSTOMERS_URL);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(request?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(request?.headers.get('idempotency-key')).toBe(stripeIdempotencyKey('customer', 'dev_1'));
    // The developer id never travels in clear text inside the header.
    expect(request?.headers.get('idempotency-key')).not.toContain('dev_1');
    expect(request?.form).toEqual({
      email: 'dev@example.com',
      name: 'Jenny Rosen',
      'metadata[developerId]': 'dev_1',
    });

    // The same developer produces the same key on a retry.
    const again = billingStripe([
      { method: 'POST', url: STRIPE_CUSTOMERS_URL, respond: () => Response.json(customerBody()) },
    ]);
    await again.payments.ensureCustomer({ developerId: 'dev_1', email: 'dev@example.com' });
    expect(again.requests[0]?.headers.get('idempotency-key')).toBe(
      request?.headers.get('idempotency-key'),
    );
    expect(again.requests[0]?.form).not.toHaveProperty('name');
  });

  it('reuses an existing customer with a GET and never posts', async () => {
    const { payments, requests } = billingStripe([
      {
        method: 'GET',
        url: `${STRIPE_CUSTOMERS_URL}/cus_existing`,
        respond: () =>
          Response.json(customerBody({ id: 'cus_existing', email: 'old@example.com' })),
      },
    ]);

    await expect(
      payments.ensureCustomer({
        developerId: 'dev_1',
        email: 'new@example.com',
        existingCustomerId: 'cus_existing',
      }),
    ).resolves.toEqual({ customerId: 'cus_existing', email: 'old@example.com' });
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('falls through to a new customer when the stored one is deleted or gone', async () => {
    for (const respond of [
      () => Response.json({ id: 'cus_gone', object: 'customer', deleted: true }),
      () => Response.json({ error: { message: 'No such customer' } }, { status: 404 }),
    ]) {
      const { payments, requests } = billingStripe([
        { method: 'GET', url: `${STRIPE_CUSTOMERS_URL}/cus_gone`, respond },
        {
          method: 'POST',
          url: STRIPE_CUSTOMERS_URL,
          respond: () => Response.json(customerBody({ id: 'cus_new' })),
        },
      ]);
      await expect(
        payments.ensureCustomer({
          developerId: 'dev_1',
          email: 'dev@example.com',
          existingCustomerId: 'cus_gone',
        }),
      ).resolves.toEqual({ customerId: 'cus_new', email: 'dev@example.com' });
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
    }
  });

  it('surfaces a lookup failure that is not a 404, and rejects bad input', async () => {
    const { payments } = billingStripe([
      {
        method: 'GET',
        url: `${STRIPE_CUSTOMERS_URL}/cus_x`,
        respond: () =>
          Response.json({ error: { message: 'Invalid API Key provided' } }, { status: 401 }),
      },
    ]);
    const error = await errorOf(
      payments.ensureCustomer({
        developerId: 'dev_1',
        email: 'dev@example.com',
        existingCustomerId: 'cus_x',
      }),
    );
    expect(error).toMatchObject({ code: 'provider_error', status: 401 });
    expect(error.message).not.toContain(SECRET_KEY);

    const { payments: strict, fetchMock } = billingStripe([]);
    expect(await codeOf(strict.ensureCustomer({ developerId: '', email: 'a@b.co' }))).toBe(
      'invalid_payload',
    );
    expect(await codeOf(strict.ensureCustomer({ developerId: 'dev_1', email: 'nope' }))).toBe(
      'invalid_payload',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ensureUsageSubscription', () => {
  it('subscribes the customer to the metered price', async () => {
    const { payments, requests } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_SUBSCRIPTIONS_URL,
        respond: () => Response.json(subscriptionBody({ itemPeriodEnd: 1_790_000_000 })),
      },
    ]);

    await expect(
      payments.ensureUsageSubscription({ customerId: 'cus_123', developerId: 'dev_1' }),
    ).resolves.toEqual({
      subscriptionId: 'sub_123',
      status: 'active',
      currentPeriodEnd: new Date(1_790_000_000 * 1000).toISOString(),
      meterId: 'mtr_active_wallets',
    });

    const request = requests[0];
    expect(request?.url).toBe(STRIPE_SUBSCRIPTIONS_URL);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('idempotency-key')).toBe(
      stripeIdempotencyKey('subscription', 'cus_123'),
    );
    expect(request?.form).toEqual({
      customer: 'cus_123',
      'items[0][price]': PRICE_ID,
      'metadata[developerId]': 'dev_1',
    });
  });

  it('reads the period end from the subscription when the API version still carries it', async () => {
    const { payments } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_SUBSCRIPTIONS_URL,
        respond: () => Response.json(subscriptionBody({ currentPeriodEnd: 1_780_000_000 })),
      },
    ]);
    await expect(
      payments.ensureUsageSubscription({ customerId: 'cus_123' }),
    ).resolves.toMatchObject({
      currentPeriodEnd: new Date(1_780_000_000 * 1000).toISOString(),
    });
  });

  it('returns a null period end and a null meter when the price exposes none', async () => {
    const { payments, requests } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_SUBSCRIPTIONS_URL,
        respond: () => Response.json(subscriptionBody({ meter: null })),
      },
    ]);
    await expect(payments.ensureUsageSubscription({ customerId: 'cus_123' })).resolves.toEqual({
      subscriptionId: 'sub_123',
      status: 'active',
      currentPeriodEnd: null,
      meterId: null,
    });
    expect(requests[0]?.form).not.toHaveProperty('metadata[developerId]');
  });

  it('reuses an active or trialing subscription', async () => {
    for (const status of ['active', 'trialing']) {
      const { payments, requests } = billingStripe([
        {
          method: 'GET',
          url: `${STRIPE_SUBSCRIPTIONS_URL}/sub_existing`,
          respond: () => Response.json(subscriptionBody({ id: 'sub_existing', status })),
        },
      ]);
      await expect(
        payments.ensureUsageSubscription({
          customerId: 'cus_123',
          existingSubscriptionId: 'sub_existing',
        }),
      ).resolves.toMatchObject({ subscriptionId: 'sub_existing', status });
      expect(requests.map((request) => request.method)).toEqual(['GET']);
    }
  });

  it('recreates a canceled, unpaid or missing subscription', async () => {
    const gone = () =>
      Response.json({ error: { message: 'No such subscription' } }, { status: 404 });
    for (const respond of [
      () => Response.json(subscriptionBody({ id: 'sub_old', status: 'canceled' })),
      () => Response.json(subscriptionBody({ id: 'sub_old', status: 'unpaid' })),
      gone,
    ]) {
      const { payments, requests } = billingStripe([
        { method: 'GET', url: `${STRIPE_SUBSCRIPTIONS_URL}/sub_old`, respond },
        {
          method: 'POST',
          url: STRIPE_SUBSCRIPTIONS_URL,
          respond: () => Response.json(subscriptionBody({ id: 'sub_new' })),
        },
      ]);
      await expect(
        payments.ensureUsageSubscription({
          customerId: 'cus_123',
          existingSubscriptionId: 'sub_old',
        }),
      ).resolves.toMatchObject({ subscriptionId: 'sub_new', status: 'active' });
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
    }
  });

  it('refuses to work without activeWalletPriceId', async () => {
    const { payments, fetchMock } = stripeWith([], { meterName: METER_NAME });
    const error = await errorOf(payments.ensureUsageSubscription({ customerId: 'cus_123' }));
    expect(error.code).toBe('provider_error');
    expect(error.message).toContain('activeWalletPriceId');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing customer id and an unexpected body', async () => {
    const { payments } = billingStripe([
      { method: 'POST', url: STRIPE_SUBSCRIPTIONS_URL, respond: () => Response.json({ id: 42 }) },
    ]);
    expect(await codeOf(payments.ensureUsageSubscription({ customerId: '' }))).toBe(
      'invalid_payload',
    );
    expect(await codeOf(payments.ensureUsageSubscription({ customerId: 'cus_123' }))).toBe(
      'provider_error',
    );
  });
});

describe('recordActiveWallets', () => {
  it('posts a billing meter event with the identifier and optional timestamp', async () => {
    const { payments, requests } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_METER_EVENTS_URL,
        respond: () =>
          Response.json({ object: 'billing.meter_event', identifier: 'maw:dev_1:2026-09-17' }),
      },
    ]);

    await expect(
      payments.recordActiveWallets({
        customerId: 'cus_123',
        event: { identifier: 'maw:dev_1:2026-09-17', value: 742, timestampSeconds: NOW_SECONDS },
      }),
    ).resolves.toBeUndefined();

    const request = requests[0];
    expect(request?.url).toBe(STRIPE_METER_EVENTS_URL);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('idempotency-key')).toBe(
      stripeIdempotencyKey('meter-event', 'maw:dev_1:2026-09-17'),
    );
    expect(request?.form).toEqual({
      event_name: METER_NAME,
      'payload[stripe_customer_id]': 'cus_123',
      'payload[value]': '742',
      identifier: 'maw:dev_1:2026-09-17',
      timestamp: String(NOW_SECONDS),
    });

    // Resending the same identifier is safe: Stripe deduplicates on it.
    await payments.recordActiveWallets({
      customerId: 'cus_123',
      event: { identifier: 'maw:dev_1:2026-09-17', value: 742, timestampSeconds: NOW_SECONDS },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get('idempotency-key')).toBe(
      request?.headers.get('idempotency-key'),
    );
  });

  it('omits the timestamp when the caller does not set one, and accepts zero', async () => {
    const { payments, requests } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_METER_EVENTS_URL,
        respond: () => Response.json({ object: 'billing.meter_event' }),
      },
    ]);
    await payments.recordActiveWallets({
      customerId: 'cus_123',
      event: { identifier: 'maw:dev_1:2026-09-18', value: 0 },
    });
    expect(requests[0]?.form).toEqual({
      event_name: METER_NAME,
      'payload[stripe_customer_id]': 'cus_123',
      'payload[value]': '0',
      identifier: 'maw:dev_1:2026-09-18',
    });
  });

  it('refuses to work without activeWalletMeterName', async () => {
    const { payments, fetchMock } = stripeWith([], { priceId: PRICE_ID });
    const error = await errorOf(
      payments.recordActiveWallets({
        customerId: 'cus_123',
        event: { identifier: 'maw:dev_1:2026-09-17', value: 1 },
      }),
    );
    expect(error.code).toBe('provider_error');
    expect(error.message).toContain('activeWalletMeterName');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the event before calling Stripe and maps Stripe failures', async () => {
    const { payments, fetchMock } = billingStripe([]);
    for (const event of [
      { identifier: '', value: 1 },
      { identifier: 'maw:dev_1:2026-09-17', value: -1 },
      { identifier: 'maw:dev_1:2026-09-17', value: 1.5 },
      { identifier: 'maw:dev_1:2026-09-17', value: 1, timestampSeconds: 1.5 },
    ]) {
      expect(await codeOf(payments.recordActiveWallets({ customerId: 'cus_123', event }))).toBe(
        'invalid_payload',
      );
    }
    expect(
      await codeOf(
        payments.recordActiveWallets({ customerId: '', event: { identifier: 'a', value: 1 } }),
      ),
    ).toBe('invalid_payload');
    expect(fetchMock).not.toHaveBeenCalled();

    const failing = billingStripe([
      {
        method: 'POST',
        url: STRIPE_METER_EVENTS_URL,
        respond: () => Response.json({ error: { message: 'Unknown meter' } }, { status: 400 }),
      },
    ]);
    const error = await errorOf(
      failing.payments.recordActiveWallets({
        customerId: 'cus_123',
        event: { identifier: 'maw:dev_1:2026-09-17', value: 1 },
      }),
    );
    expect(error).toMatchObject({ code: 'provider_error', status: 400 });
    expect(error.message).toContain('Unknown meter');
  });
});

describe('createBillingPortalSession', () => {
  it('posts customer and return_url and returns the portal url', async () => {
    const url = 'https://billing.stripe.com/p/session/test_123';
    const { payments, requests } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_BILLING_PORTAL_SESSIONS_URL,
        respond: () => Response.json({ id: 'bps_1', object: 'billing_portal.session', url }),
      },
    ]);

    await expect(
      payments.createBillingPortalSession({
        customerId: 'cus_123',
        returnUrl: 'https://dash.pocketkey.dev/billing',
      }),
    ).resolves.toEqual({ url });

    const request = requests[0];
    expect(request?.url).toBe(STRIPE_BILLING_PORTAL_SESSIONS_URL);
    expect(request?.method).toBe('POST');
    expect(request?.form).toEqual({
      customer: 'cus_123',
      return_url: 'https://dash.pocketkey.dev/billing',
    });
  });

  it('rejects a bad return url and an unexpected body', async () => {
    const { payments, fetchMock } = billingStripe([
      {
        method: 'POST',
        url: STRIPE_BILLING_PORTAL_SESSIONS_URL,
        respond: () => Response.json({ id: 'bps_1' }),
      },
    ]);
    expect(
      await codeOf(
        payments.createBillingPortalSession({
          customerId: 'cus_123',
          returnUrl: 'javascript:alert(1)',
        }),
      ),
    ).toBe('invalid_payload');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await codeOf(
        payments.createBillingPortalSession({
          customerId: 'cus_123',
          returnUrl: 'https://dash.pocketkey.dev/billing',
        }),
      ),
    ).toBe('provider_error');
  });
});

describe('parseWebhook (billing events)', () => {
  it('maps subscription created, updated and deleted', async () => {
    for (const [type, status, expected] of [
      ['customer.subscription.created', 'active', 'active'],
      ['customer.subscription.updated', 'past_due', 'past_due'],
      ['customer.subscription.deleted', 'canceled', 'canceled'],
    ] as const) {
      const payload = eventPayload(type, {
        id: 'sub_123',
        object: 'subscription',
        customer: 'cus_123',
        status,
      });
      await expect(parseEvent(payload)).resolves.toEqual({
        type: 'billing.updated',
        eventId: 'evt_billing_1',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: expected,
        providerType: type,
      });
    }
  });

  it('defaults a deleted subscription without a status to canceled, and reads an expanded customer', async () => {
    const payload = eventPayload('customer.subscription.deleted', {
      id: 'sub_123',
      object: 'subscription',
      customer: { id: 'cus_123', object: 'customer' },
    });
    await expect(parseEvent(payload)).resolves.toMatchObject({
      type: 'billing.updated',
      customerId: 'cus_123',
      status: 'canceled',
    });
  });

  it('maps invoice.paid and invoice.payment_failed, old and new subscription shapes', async () => {
    const paid = eventPayload('invoice.paid', {
      id: 'in_1',
      object: 'invoice',
      customer: 'cus_123',
      status: 'paid',
      subscription: 'sub_123',
    });
    await expect(parseEvent(paid)).resolves.toEqual({
      type: 'billing.updated',
      eventId: 'evt_billing_1',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
      status: 'paid',
      providerType: 'invoice.paid',
    });

    const failed = eventPayload('invoice.payment_failed', {
      id: 'in_2',
      object: 'invoice',
      customer: 'cus_123',
      status: 'open',
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_456' } },
    });
    await expect(parseEvent(failed)).resolves.toEqual({
      type: 'billing.updated',
      eventId: 'evt_billing_1',
      customerId: 'cus_123',
      subscriptionId: 'sub_456',
      status: 'open',
      providerType: 'invoice.payment_failed',
    });
  });

  it('omits subscriptionId on a one-off invoice and falls back on a missing status', async () => {
    const payload = eventPayload('invoice.payment_failed', {
      id: 'in_3',
      object: 'invoice',
      customer: 'cus_123',
    });
    const event = await parseEvent(payload);
    expect(event).toEqual({
      type: 'billing.updated',
      eventId: 'evt_billing_1',
      customerId: 'cus_123',
      status: 'payment_failed',
      providerType: 'invoice.payment_failed',
    });
    expect(event).not.toHaveProperty('subscriptionId');
  });

  it('ignores billing events without a customer instead of rejecting them', async () => {
    for (const type of [
      'customer.subscription.updated',
      'invoice.paid',
      'invoice.payment_failed',
    ]) {
      await expect(parseEvent(eventPayload(type, {}))).resolves.toEqual({
        type: 'ignored',
        eventId: 'evt_billing_1',
        providerType: type,
      });
    }
  });

  it('still ignores unrelated events and still maps top-ups', async () => {
    const other = eventPayload('customer.updated', { id: 'cus_123', object: 'customer' });
    await expect(parseEvent(other)).resolves.toEqual({
      type: 'ignored',
      eventId: 'evt_billing_1',
      providerType: 'customer.updated',
    });

    const topUp = eventPayload('checkout.session.completed', {
      id: 'cs_test_abc',
      object: 'checkout.session',
      payment_status: 'paid',
      amount_total: 2500,
      currency: 'usd',
      metadata: { appId: 'app_1', amountCents: '2500' },
    });
    await expect(parseEvent(topUp)).resolves.toEqual({
      type: 'topup.completed',
      eventId: 'evt_billing_1',
      appId: 'app_1',
      amountCents: 2500,
      checkoutId: 'cs_test_abc',
    });
  });
});

describe('createMockPayments (billing)', () => {
  it('round trips customers, subscriptions, meter events and the portal', async () => {
    const payments = createMockPayments({ baseUrl: 'http://localhost:9999/' });

    const customer = await payments.ensureCustomer({ developerId: 'dev_1', email: 'a@b.co' });
    expect(customer.customerId).toMatch(/^cus_mock_[0-9a-f]{24}$/);
    expect(customer.email).toBe('a@b.co');
    // Deterministic and idempotent per developer.
    await expect(
      payments.ensureCustomer({ developerId: 'dev_1', email: 'a@b.co' }),
    ).resolves.toEqual(customer);
    await expect(
      payments.ensureCustomer({
        developerId: 'dev_1',
        email: 'a@b.co',
        existingCustomerId: customer.customerId,
      }),
    ).resolves.toEqual(customer);
    const other = await payments.ensureCustomer({ developerId: 'dev_2', email: 'c@d.co' });
    expect(other.customerId).not.toBe(customer.customerId);

    const subscription = await payments.ensureUsageSubscription({
      customerId: customer.customerId,
    });
    expect(subscription.subscriptionId).toMatch(/^sub_mock_[0-9a-f]{24}$/);
    expect(subscription.status).toBe('active');
    expect(subscription.meterId).toBe(MOCK_ACTIVE_WALLET_METER_ID);
    expect(subscription.currentPeriodEnd).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    await expect(
      payments.ensureUsageSubscription({
        customerId: customer.customerId,
        existingSubscriptionId: subscription.subscriptionId,
      }),
    ).resolves.toEqual(subscription);

    await payments.recordActiveWallets({
      customerId: customer.customerId,
      event: { identifier: 'maw:dev_1:2026-09-17', value: 620 },
    });
    // Same identifier twice stays one event, like Stripe.
    await payments.recordActiveWallets({
      customerId: customer.customerId,
      event: { identifier: 'maw:dev_1:2026-09-17', value: 620 },
    });
    await payments.recordActiveWallets({
      customerId: customer.customerId,
      event: { identifier: 'maw:dev_1:2026-09-18', value: 700, timestampSeconds: NOW_SECONDS },
    });
    expect(payments.meterEvents()).toEqual([
      {
        customerId: customer.customerId,
        event: { identifier: 'maw:dev_1:2026-09-17', value: 620 },
      },
      {
        customerId: customer.customerId,
        event: { identifier: 'maw:dev_1:2026-09-18', value: 700, timestampSeconds: NOW_SECONDS },
      },
    ]);

    const portal = await payments.createBillingPortalSession({
      customerId: customer.customerId,
      returnUrl: 'http://localhost:3810/billing',
    });
    expect(portal.url).toBe(
      `http://localhost:9999/mock/billing-portal/${customer.customerId}?return_url=${encodeURIComponent('http://localhost:3810/billing')}`,
    );
  });

  it('creates a new customer after a delete and a new subscription after a cancel', async () => {
    const payments = createMockPayments();
    const first = await payments.ensureCustomer({ developerId: 'dev_1', email: 'a@b.co' });
    payments.deleteCustomer(first.customerId);
    const second = await payments.ensureCustomer({
      developerId: 'dev_1',
      email: 'a@b.co',
      existingCustomerId: first.customerId,
    });
    expect(second.customerId).not.toBe(first.customerId);

    const live = await payments.ensureUsageSubscription({ customerId: second.customerId });
    payments.cancelSubscription(live.subscriptionId);
    const renewed = await payments.ensureUsageSubscription({
      customerId: second.customerId,
      existingSubscriptionId: live.subscriptionId,
    });
    expect(renewed.subscriptionId).not.toBe(live.subscriptionId);
    expect(renewed.status).toBe('active');
  });

  it('validates like the Stripe implementation and signs billing webhooks', async () => {
    const payments = createMockPayments();
    expect(await codeOf(payments.ensureCustomer({ developerId: 'dev_1', email: 'nope' }))).toBe(
      'invalid_payload',
    );
    expect(await codeOf(payments.ensureUsageSubscription({ customerId: '' }))).toBe(
      'invalid_payload',
    );
    expect(
      await codeOf(
        payments.recordActiveWallets({
          customerId: 'cus_1',
          event: { identifier: 'x', value: -1 },
        }),
      ),
    ).toBe('invalid_payload');
    expect(
      await codeOf(
        payments.createBillingPortalSession({ customerId: 'cus_1', returnUrl: 'ftp://x/y' }),
      ),
    ).toBe('invalid_payload');
    expect(payments.meterEvents()).toEqual([]);

    const signedEvent = payments.billingEvent({
      customerId: 'cus_mock_1',
      subscriptionId: 'sub_mock_1',
      status: 'past_due',
    });
    await expect(payments.parseWebhook(signedEvent)).resolves.toMatchObject({
      type: 'billing.updated',
      customerId: 'cus_mock_1',
      subscriptionId: 'sub_mock_1',
      status: 'past_due',
      providerType: 'customer.subscription.updated',
    });
  });
});

describe('estimateMonthlyCents', () => {
  it('bills nothing up to the free allowance and 6 cents per wallet above it', () => {
    expect(estimateMonthlyCents(0)).toBe(0);
    expect(estimateMonthlyCents(1)).toBe(0);
    expect(estimateMonthlyCents(FREE_MONTHLY_ACTIVE_WALLETS - 1)).toBe(0);
    expect(estimateMonthlyCents(FREE_MONTHLY_ACTIVE_WALLETS)).toBe(0);
    expect(estimateMonthlyCents(FREE_MONTHLY_ACTIVE_WALLETS + 1)).toBe(
      PRICE_CENTS_PER_ACTIVE_WALLET,
    );
    expect(estimateMonthlyCents(1500)).toBe(1000 * PRICE_CENTS_PER_ACTIVE_WALLET);
    expect(estimateMonthlyCents(1500)).toBe(6000);
  });

  it('honours custom options', () => {
    expect(estimateMonthlyCents(100, { includedWallets: 0 })).toBe(600);
    expect(estimateMonthlyCents(100, { includedWallets: 0, unitPriceCents: 8 })).toBe(800);
    expect(estimateMonthlyCents(1000, { includedWallets: 2000 })).toBe(0);
    expect(estimateMonthlyCents(1000, { unitPriceCents: 0 })).toBe(0);
    // Fractional unit prices are rounded to whole cents.
    expect(estimateMonthlyCents(600, { unitPriceCents: 0.5 })).toBe(50);
  });

  it('never returns a negative number', () => {
    for (const wallets of [-1, -1000, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(estimateMonthlyCents(wallets)).toBe(0);
    }
    expect(estimateMonthlyCents(1000, { unitPriceCents: -10 })).toBe(0);
    expect(estimateMonthlyCents(1000, { includedWallets: -10 })).toBe(6000);
    expect(estimateMonthlyCents(1000.9)).toBe(500 * PRICE_CENTS_PER_ACTIVE_WALLET);
  });
});
