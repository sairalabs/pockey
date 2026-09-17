/**
 * @pocketkey/payments (private, server side)
 *
 * Payments port over fetch and WebCrypto, no SDK, so it runs on Workers:
 * prepaid gas sponsoring top-ups through Stripe Checkout (section 7.5, T4.6) and
 * the usage based billing of section 11 (customer, metered subscription, billing
 * meter events, billing portal, T5.4), plus webhook verification for both.
 * `createMockPayments` for tests and local development.
 */
export { PaymentsError, type PaymentsErrorCode } from './errors.js';
export type {
  BillingCustomer,
  BillingSubscription,
  EnsureCustomerInput,
  EnsureUsageSubscriptionInput,
  MeterEvent,
  PaymentEvent,
  Payments,
  TopUpCheckoutRequest,
} from './types.js';
export {
  ACTIVE_SUBSCRIPTION_STATUSES,
  billingPortalForm,
  customerForm,
  estimateMonthlyCents,
  meterEventForm,
  usageSubscriptionForm,
} from './billing.js';
export {
  checkoutSessionForm,
  createStripePayments,
  stripeIdempotencyKey,
  STRIPE_BILLING_PORTAL_SESSIONS_URL,
  STRIPE_CHECKOUT_SESSIONS_URL,
  STRIPE_CUSTOMERS_URL,
  STRIPE_METER_EVENTS_URL,
  STRIPE_SUBSCRIPTIONS_URL,
  TOP_UP_PRODUCT_NAME,
  type StripePaymentsOptions,
} from './stripe.js';
export { DEFAULT_TOLERANCE_SECONDS } from './webhook.js';
export {
  createMockPayments,
  MOCK_ACTIVE_WALLET_METER_ID,
  MOCK_WEBHOOK_SECRET,
  type MockPayments,
  type RecordedMeterEvent,
  type SignedStripeEvent,
} from './mock.js';
