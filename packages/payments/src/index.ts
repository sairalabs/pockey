/**
 * @pocketkey/payments (private, server side)
 *
 * Payments port for prepaid gas sponsoring top-ups (section 7.5, T4.6): Stripe
 * Checkout and webhook verification over fetch and WebCrypto, no SDK, so it runs
 * on Workers. `createMockPayments` for tests and local development.
 */
export { PaymentsError, type PaymentsErrorCode } from './errors.js';
export type { PaymentEvent, Payments, TopUpCheckoutRequest } from './types.js';
export {
  checkoutSessionForm,
  createStripePayments,
  STRIPE_CHECKOUT_SESSIONS_URL,
  TOP_UP_PRODUCT_NAME,
} from './stripe.js';
export { DEFAULT_TOLERANCE_SECONDS } from './webhook.js';
export { createMockPayments, MOCK_WEBHOOK_SECRET } from './mock.js';
