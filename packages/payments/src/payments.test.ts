import { describe, expect, it, vi } from 'vitest';
import { PaymentsError } from './errors.js';
import { createMockPayments, MOCK_WEBHOOK_SECRET } from './mock.js';
import { hmacSha256, sha256, toHex } from './sha256.js';
import { createStripePayments, STRIPE_CHECKOUT_SESSIONS_URL } from './stripe.js';
import { parseSignatureHeader, timingSafeEqualHex } from './webhook.js';

const SECRET_KEY = 'sk_test_do_not_leak';
const WEBHOOK_SECRET = 'whsec_test_secret';
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1000);
const encoder = new TextEncoder();

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

function checkoutEvent(
  overrides: {
    type?: string;
    paymentStatus?: string;
    amountTotal?: number | null;
    metadata?: Record<string, string> | null;
    currency?: string;
  } = {},
): string {
  return JSON.stringify({
    id: 'evt_123',
    object: 'event',
    type: overrides.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_abc',
        object: 'checkout.session',
        payment_status: overrides.paymentStatus ?? 'paid',
        amount_total: overrides.amountTotal === undefined ? 2500 : overrides.amountTotal,
        currency: overrides.currency ?? 'usd',
        metadata:
          overrides.metadata === undefined
            ? { appId: 'app_1', amountCents: '2500' }
            : overrides.metadata,
      },
    },
  });
}

function stripe(fetchImpl?: typeof fetch) {
  return createStripePayments({
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentsError);
  return (error as PaymentsError).code;
}

describe('createTopUpCheckout (Stripe)', () => {
  it('posts a form-encoded checkout session with auth and idempotency headers', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return Response.json({
        id: 'cs_test_abc',
        url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
      });
    });
    const payments = stripe(fetchMock);
    const input = {
      appId: 'app_1',
      amountCents: 2500,
      successUrl: 'https://dash.pocketkey.dev/apps/app_1/sponsoring?ok=1',
      cancelUrl: 'https://dash.pocketkey.dev/apps/app_1/sponsoring',
    };

    await expect(
      payments.createTopUpCheckout({ ...input, customerEmail: 'dev@example.com' }),
    ).resolves.toEqual({
      checkoutId: 'cs_test_abc',
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
    });
    await payments.createTopUpCheckout(input);

    expect(requests).toHaveLength(2);
    const first = requests[0];
    expect(first?.url).toBe(STRIPE_CHECKOUT_SESSIONS_URL);
    expect(first?.init?.method).toBe('POST');
    const headers = new Headers(first?.init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    const key1 = headers.get('idempotency-key');
    const key2 = new Headers(requests[1]?.init?.headers).get('idempotency-key');
    expect(key1).toMatch(/^[0-9a-f-]{36}$/);
    expect(key2).toMatch(/^[0-9a-f-]{36}$/);
    expect(key1).not.toBe(key2);

    const formOf = (init: RequestInit | undefined) => {
      const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      const fields: Record<string, string> = {};
      params.forEach((value, key) => {
        fields[key] = value;
      });
      return fields;
    };
    expect(formOf(first?.init)).toEqual({
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '2500',
      'line_items[0][price_data][product_data][name]': 'Pocketkey gas sponsoring credit',
      'line_items[0][quantity]': '1',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'metadata[appId]': 'app_1',
      'metadata[amountCents]': '2500',
      'payment_intent_data[metadata][appId]': 'app_1',
      customer_email: 'dev@example.com',
    });
    expect(formOf(requests[1]?.init)).not.toHaveProperty('customer_email');
    expect(formOf(requests[1]?.init)).toHaveProperty(['metadata[appId]'], 'app_1');
  });

  it('maps Stripe errors to provider_error without leaking the key', async () => {
    const payments = stripe(async () =>
      Response.json({ error: { message: 'Invalid API Key provided' } }, { status: 401 }),
    );
    const error: unknown = await payments
      .createTopUpCheckout({
        appId: 'app_1',
        amountCents: 500,
        successUrl: 'https://a.test/ok',
        cancelUrl: 'https://a.test/no',
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'provider_error', status: 401 });
    expect((error as Error).message).toContain('Invalid API Key provided');
    expect((error as Error).message).not.toContain(SECRET_KEY);
  });

  it('maps network failures and odd bodies to provider_error', async () => {
    const input = {
      appId: 'app_1',
      amountCents: 500,
      successUrl: 'https://a.test/ok',
      cancelUrl: 'https://a.test/no',
    };
    expect(
      await codeOf(
        stripe(async () => {
          throw new TypeError('fetch failed');
        }).createTopUpCheckout(input),
      ),
    ).toBe('provider_error');
    expect(
      await codeOf(stripe(async () => Response.json({ id: 42 })).createTopUpCheckout(input)),
    ).toBe('provider_error');
  });

  it('validates input before calling Stripe', async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    const payments = stripe(fetchMock);
    const base = {
      appId: 'app_1',
      amountCents: 500,
      successUrl: 'https://a.test/ok',
      cancelUrl: 'https://a.test/no',
    };
    for (const input of [
      { ...base, amountCents: 0 },
      { ...base, amountCents: 10.5 },
      { ...base, appId: '' },
      { ...base, successUrl: 'javascript:alert(1)' },
    ]) {
      expect(await codeOf(payments.createTopUpCheckout(input))).toBe('invalid_payload');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseWebhook (Stripe)', () => {
  it('accepts a valid paid checkout.session.completed', async () => {
    const payload = checkoutEvent();
    await expect(
      stripe().parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW }),
    ).resolves.toEqual({
      type: 'topup.completed',
      eventId: 'evt_123',
      appId: 'app_1',
      amountCents: 2500,
      checkoutId: 'cs_test_abc',
    });
  });

  it('rejects a signature made with another secret', async () => {
    const payload = checkoutEvent();
    const header = await signed(payload, 'whsec_wrong');
    expect(
      await codeOf(stripe().parseWebhook({ payload, signatureHeader: header, now: NOW })),
    ).toBe('invalid_signature');
  });

  it('rejects a tampered payload, a missing header and a malformed header', async () => {
    const payload = checkoutEvent();
    const header = await signed(payload);
    const tampered = checkoutEvent({
      amountTotal: 999_999,
      metadata: { appId: 'app_1', amountCents: '999999' },
    });
    const payments = stripe();
    const parse = (input: Parameters<typeof payments.parseWebhook>[0]) =>
      payments.parseWebhook(input);
    expect(await codeOf(parse({ payload: tampered, signatureHeader: header, now: NOW }))).toBe(
      'invalid_signature',
    );
    expect(await codeOf(parse({ payload, signatureHeader: null, now: NOW }))).toBe(
      'invalid_signature',
    );
    expect(await codeOf(parse({ payload, signatureHeader: 'garbage', now: NOW }))).toBe(
      'invalid_signature',
    );
    expect(await codeOf(parse({ payload, signatureHeader: `t=${NOW_SECONDS}`, now: NOW }))).toBe(
      'invalid_signature',
    );
  });

  it('rejects a stale timestamp with the default 300 s tolerance', async () => {
    const payload = checkoutEvent();
    const old = NOW_SECONDS - 301;
    const header = await signed(payload, WEBHOOK_SECRET, old);
    expect(
      await codeOf(stripe().parseWebhook({ payload, signatureHeader: header, now: NOW })),
    ).toBe('stale_signature');
    // exactly at the limit is still accepted
    const edge = await signed(payload, WEBHOOK_SECRET, NOW_SECONDS - 300);
    await expect(
      stripe().parseWebhook({ payload, signatureHeader: edge, now: NOW }),
    ).resolves.toMatchObject({ type: 'topup.completed' });
    // custom tolerance
    const strict = createStripePayments({
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
      toleranceSeconds: 10,
    });
    const recent = await signed(payload, WEBHOOK_SECRET, NOW_SECONDS - 11);
    expect(await codeOf(strict.parseWebhook({ payload, signatureHeader: recent, now: NOW }))).toBe(
      'stale_signature',
    );
  });

  it('accepts any matching v1 among several (secret rotation)', async () => {
    const payload = checkoutEvent();
    const good = (await signed(payload)).split('v1=')[1] ?? '';
    const bad = 'ab'.repeat(32);
    const header = `t=${NOW_SECONDS},v1=${bad},v0=${bad},v1=${good}`;
    await expect(
      stripe().parseWebhook({ payload, signatureHeader: header, now: NOW }),
    ).resolves.toMatchObject({ type: 'topup.completed', appId: 'app_1' });
  });

  it('ignores checkout sessions that are not paid', async () => {
    const payload = checkoutEvent({ paymentStatus: 'unpaid' });
    await expect(
      stripe().parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW }),
    ).resolves.toEqual({
      type: 'ignored',
      eventId: 'evt_123',
      providerType: 'checkout.session.completed',
    });
  });

  it('treats async_payment_succeeded like a completed payment', async () => {
    const payload = checkoutEvent({ type: 'checkout.session.async_payment_succeeded' });
    await expect(
      stripe().parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW }),
    ).resolves.toMatchObject({ type: 'topup.completed', amountCents: 2500 });
  });

  it('rejects an amount_total that differs from metadata amountCents', async () => {
    const payload = checkoutEvent({ amountTotal: 2400 });
    expect(
      await codeOf(
        stripe().parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW }),
      ),
    ).toBe('invalid_payload');
    const noAmount = checkoutEvent({ metadata: { appId: 'app_1' } });
    expect(
      await codeOf(
        stripe().parseWebhook({
          payload: noAmount,
          signatureHeader: await signed(noAmount),
          now: NOW,
        }),
      ),
    ).toBe('invalid_payload');
    const euro = checkoutEvent({ currency: 'eur' });
    expect(
      await codeOf(
        stripe().parseWebhook({ payload: euro, signatureHeader: await signed(euro), now: NOW }),
      ),
    ).toBe('invalid_payload');
  });

  it('ignores unknown events and paid sessions without Pocketkey metadata', async () => {
    const unknown = JSON.stringify({ id: 'evt_9', type: 'invoice.paid', data: { object: {} } });
    await expect(
      stripe().parseWebhook({ payload: unknown, signatureHeader: await signed(unknown), now: NOW }),
    ).resolves.toEqual({ type: 'ignored', eventId: 'evt_9', providerType: 'invoice.paid' });

    const foreign = checkoutEvent({ metadata: null });
    await expect(
      stripe().parseWebhook({ payload: foreign, signatureHeader: await signed(foreign), now: NOW }),
    ).resolves.toMatchObject({ type: 'ignored' });
  });

  it('rejects signed bodies that are not Stripe events', async () => {
    for (const payload of ['not json', '[]', JSON.stringify({ type: 'x' })]) {
      expect(
        await codeOf(
          stripe().parseWebhook({ payload, signatureHeader: await signed(payload), now: NOW }),
        ),
      ).toBe('invalid_payload');
    }
  });
});

describe('createMockPayments', () => {
  it('round trips a completed top-up through the Stripe verification path', async () => {
    const payments = createMockPayments({ baseUrl: 'http://localhost:9999/' });
    const checkout = await payments.createTopUpCheckout({
      appId: 'app_mock',
      amountCents: 1000,
      successUrl: 'http://localhost:3810/ok',
      cancelUrl: 'http://localhost:3810/cancel',
    });
    expect(checkout.checkoutId).toMatch(/^cs_mock_[0-9a-f]{32}$/);
    expect(checkout.url).toBe(`http://localhost:9999/mock/checkout/${checkout.checkoutId}`);

    const { payload, signatureHeader } = payments.completedEvent('app_mock', 1000);
    const event = await payments.parseWebhook({ payload, signatureHeader });
    expect(event).toMatchObject({ type: 'topup.completed', appId: 'app_mock', amountCents: 1000 });

    // The same event also verifies with the real Stripe implementation and the mock secret.
    const real = createStripePayments({ secretKey: 'sk_x', webhookSecret: MOCK_WEBHOOK_SECRET });
    await expect(real.parseWebhook({ payload, signatureHeader })).resolves.toEqual(event);

    // And it is rejected by a Stripe implementation with a different secret.
    expect(await codeOf(stripe().parseWebhook({ payload, signatureHeader }))).toBe(
      'invalid_signature',
    );
  });

  it('refuses tampered mock events', async () => {
    const payments = createMockPayments();
    const { payload, signatureHeader } = payments.completedEvent('app_mock', 1000);
    expect(
      await codeOf(
        payments.parseWebhook({
          payload: payload.replace('app_mock', 'app_evil'),
          signatureHeader,
        }),
      ),
    ).toBe('invalid_signature');
  });
});

describe('crypto helpers', () => {
  it('sha256 matches known vectors', () => {
    expect(toHex(sha256(new Uint8Array()))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(encoder.encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sync HMAC matches WebCrypto across lengths', async () => {
    for (const [keyLength, messageLength] of [
      [1, 0],
      [16, 55],
      [64, 56],
      [65, 64],
      [100, 1000],
    ] as const) {
      const key = 'k'.repeat(keyLength);
      const message = 'm'.repeat(messageLength);
      expect(toHex(hmacSha256(encoder.encode(key), encoder.encode(message)))).toBe(
        await webCryptoHmacHex(key, message),
      );
    }
  });

  it('parses signature headers and compares hex safely', () => {
    const hex = 'AB'.repeat(32);
    expect(parseSignatureHeader(`t=12, v1=${hex}, v0=zz`)).toEqual({
      timestamp: 12,
      signatures: [hex.toLowerCase()],
    });
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});
