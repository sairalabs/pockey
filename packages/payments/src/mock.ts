import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  assertEnsureCustomerInput,
  assertEnsureSubscriptionInput,
  assertMeterEvent,
  assertPortalInput,
} from './billing.js';
import { hmacSha256, sha256, toHex } from './sha256.js';
import { assertTopUpRequest } from './stripe.js';
import type { BillingSubscription, MeterEvent, Payments } from './types.js';
import { DEFAULT_TOLERANCE_SECONDS, verifyStripeWebhook } from './webhook.js';

/** Public on purpose: the mock is for tests and local development only, never production. */
export const MOCK_WEBHOOK_SECRET = 'whsec_pocketkey_mock';

/** Stand-in for the meter behind the metered price of section 11. */
export const MOCK_ACTIVE_WALLET_METER_ID = 'mtr_mock_active_wallets';

const encoder = new TextEncoder();

export interface RecordedMeterEvent {
  customerId: string;
  event: MeterEvent;
}

export interface SignedStripeEvent {
  payload: string;
  signatureHeader: string;
}

export interface MockPayments extends Payments {
  /** A signed `checkout.session.completed` for a paid top-up. */
  completedEvent(appId: string, amountCents: number): SignedStripeEvent;
  /** A signed subscription or invoice event of the usage based plan. */
  billingEvent(input: {
    customerId: string;
    subscriptionId: string;
    status?: string;
    providerType?: string;
  }): SignedStripeEvent;
  /** Every meter event accepted so far, oldest first. */
  meterEvents(): RecordedMeterEvent[];
  /** Marks a customer deleted, so the next `ensureCustomer` creates a new one. */
  deleteCustomer(customerId: string): void;
  /** Cancels a subscription, so the next `ensureUsageSubscription` creates a new one. */
  cancelSubscription(subscriptionId: string): void;
}

interface MockCustomer {
  customerId: string;
  developerId: string;
  email: string;
  deleted: boolean;
}

interface MockSubscription {
  subscriptionId: string;
  customerId: string;
  status: string;
  currentPeriodEnd: string;
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
}

/** Same input, same id: the API suite can assert on ids without a fixture. */
function deterministicId(prefix: string, seed: string): string {
  return `${prefix}${toHex(sha256(encoder.encode(seed))).slice(0, 24)}`;
}

function seedFor(key: string, generation: number): string {
  return generation === 0 ? key : `${key}#${generation}`;
}

/** First instant of the next UTC month, the period a monthly subscription ends on. */
function nextMonthStart(now: number): string {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * In-memory stand-in for Stripe. Webhooks use the real Stripe format and
 * verification path with `MOCK_WEBHOOK_SECRET`, so tests exercise the same code.
 * Billing state lives in maps: customers and subscriptions are keyed by developer
 * and by customer, so `ensure*` is idempotent the way the Stripe idempotency keys
 * make it idempotent in production.
 */
export function createMockPayments(options: { baseUrl?: string } = {}): MockPayments {
  const baseUrl = (options.baseUrl ?? 'http://localhost:8787').replace(/\/+$/, '');
  const customers = new Map<string, MockCustomer>();
  const customerByDeveloper = new Map<string, string>();
  const customerGeneration = new Map<string, number>();
  const subscriptions = new Map<string, MockSubscription>();
  const subscriptionByCustomer = new Map<string, string>();
  const subscriptionGeneration = new Map<string, number>();
  const recorded: RecordedMeterEvent[] = [];
  const seenIdentifiers = new Set<string>();

  function sign(payload: string, timestamp: number): SignedStripeEvent {
    const signature = toHex(
      hmacSha256(encoder.encode(MOCK_WEBHOOK_SECRET), encoder.encode(`${timestamp}.${payload}`)),
    );
    return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
  }

  function liveCustomer(customerId: string | undefined): MockCustomer | null {
    if (customerId === undefined) return null;
    const found = customers.get(customerId);
    return found !== undefined && !found.deleted ? found : null;
  }

  function liveSubscription(subscriptionId: string | undefined): MockSubscription | null {
    if (subscriptionId === undefined) return null;
    const found = subscriptions.get(subscriptionId);
    return found !== undefined && ACTIVE_SUBSCRIPTION_STATUSES.includes(found.status)
      ? found
      : null;
  }

  function toBillingSubscription(row: MockSubscription): BillingSubscription {
    return {
      subscriptionId: row.subscriptionId,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd,
      meterId: MOCK_ACTIVE_WALLET_METER_ID,
    };
  }

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

    async ensureCustomer(input) {
      assertEnsureCustomerInput(input);
      const reused =
        liveCustomer(input.existingCustomerId) ??
        liveCustomer(customerByDeveloper.get(input.developerId));
      if (reused !== null) return { customerId: reused.customerId, email: reused.email };

      const generation = customerGeneration.get(input.developerId) ?? 0;
      const customerId = deterministicId('cus_mock_', seedFor(input.developerId, generation));
      customers.set(customerId, {
        customerId,
        developerId: input.developerId,
        email: input.email,
        deleted: false,
      });
      customerByDeveloper.set(input.developerId, customerId);
      return { customerId, email: input.email };
    },

    async ensureUsageSubscription(input) {
      assertEnsureSubscriptionInput(input);
      const reused =
        liveSubscription(input.existingSubscriptionId) ??
        liveSubscription(subscriptionByCustomer.get(input.customerId));
      if (reused !== null) return toBillingSubscription(reused);

      const generation = subscriptionGeneration.get(input.customerId) ?? 0;
      const subscriptionId = deterministicId('sub_mock_', seedFor(input.customerId, generation));
      const row: MockSubscription = {
        subscriptionId,
        customerId: input.customerId,
        status: 'active',
        currentPeriodEnd: nextMonthStart(Date.now()),
      };
      subscriptions.set(subscriptionId, row);
      subscriptionByCustomer.set(input.customerId, subscriptionId);
      return toBillingSubscription(row);
    },

    async recordActiveWallets(input) {
      assertMeterEvent(input.customerId, input.event);
      // Stripe deduplicates on `identifier`; resending the same day is a no-op.
      if (seenIdentifiers.has(input.event.identifier)) return;
      seenIdentifiers.add(input.event.identifier);
      recorded.push({ customerId: input.customerId, event: { ...input.event } });
    },

    async createBillingPortalSession(input) {
      assertPortalInput(input);
      const url = new URL(`${baseUrl}/mock/billing-portal/${encodeURIComponent(input.customerId)}`);
      url.searchParams.set('return_url', input.returnUrl);
      return { url: url.toString() };
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
      return sign(payload, timestamp);
    },

    billingEvent(input) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        id: randomId('evt_mock_'),
        object: 'event',
        type: input.providerType ?? 'customer.subscription.updated',
        created: timestamp,
        data: {
          object: {
            id: input.subscriptionId,
            object: 'subscription',
            customer: input.customerId,
            status: input.status ?? 'active',
          },
        },
      });
      return sign(payload, timestamp);
    },

    meterEvents() {
      return recorded.map((row) => ({ customerId: row.customerId, event: { ...row.event } }));
    },

    deleteCustomer(customerId) {
      const row = customers.get(customerId);
      if (row === undefined) return;
      row.deleted = true;
      customerGeneration.set(row.developerId, (customerGeneration.get(row.developerId) ?? 0) + 1);
    },

    cancelSubscription(subscriptionId) {
      const row = subscriptions.get(subscriptionId);
      if (row === undefined) return;
      row.status = 'canceled';
      subscriptionGeneration.set(
        row.customerId,
        (subscriptionGeneration.get(row.customerId) ?? 0) + 1,
      );
    },
  };
}
