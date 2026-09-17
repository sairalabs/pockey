import { PaymentsError } from './errors.js';
import { toHex } from './sha256.js';
import type { PaymentEvent } from './types.js';

export const DEFAULT_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

/** `t=<unix seconds>,v1=<hex>[,v1=<hex>]`. Unknown schemes (v0) are ignored. */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) {
    throw new PaymentsError('invalid_signature', 'Malformed Stripe-Signature header');
  }
  return { timestamp, signatures };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

/** Compares two lowercase hex strings without an early exit on the first difference. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): PaymentsError {
  return new PaymentsError('invalid_payload', message);
}

const COMPLETED_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

/** Usage based plan lifecycle (section 11), mapped to `billing.updated`. */
const SUBSCRIPTION_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const INVOICE_TYPES = new Set(['invoice.paid', 'invoice.payment_failed']);

/** A Stripe reference is either an id or, when expanded, the object itself. */
function referenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.id === 'string' && value.id.length > 0) return value.id;
  return null;
}

/**
 * `invoice.subscription` up to API version 2025-03-31.basil, then
 * `invoice.parent.subscription_details.subscription`. Both are read.
 */
function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const direct = referenceId(invoice.subscription);
  if (direct !== null) return direct;
  const parent = invoice.parent;
  if (!isRecord(parent)) return null;
  const details = parent.subscription_details;
  if (!isRecord(details)) return null;
  return referenceId(details.subscription);
}

function billingUpdated(input: {
  eventId: string;
  providerType: string;
  customerId: string;
  subscriptionId: string | null;
  status: string;
}): PaymentEvent {
  return {
    type: 'billing.updated',
    eventId: input.eventId,
    customerId: input.customerId,
    status: input.status,
    providerType: input.providerType,
    ...(input.subscriptionId === null ? {} : { subscriptionId: input.subscriptionId }),
  };
}

/**
 * Subscription and invoice events of the usage based plan. Anything without a
 * customer is ignored rather than rejected: other products can live on the same
 * Stripe account, and Stripe replays trimmed payloads.
 */
function toBillingEvent(
  event: Record<string, unknown>,
  eventId: string,
  providerType: string,
): PaymentEvent {
  const ignored: PaymentEvent = { type: 'ignored', eventId, providerType };
  const object = isRecord(event.data) ? event.data.object : undefined;
  if (!isRecord(object)) return ignored;
  const customerId = referenceId(object.customer);
  if (customerId === null) return ignored;
  const status = typeof object.status === 'string' && object.status.length > 0 ? object.status : '';

  if (SUBSCRIPTION_TYPES.has(providerType)) {
    const resolved =
      status.length > 0
        ? status
        : providerType === 'customer.subscription.deleted'
          ? 'canceled'
          : '';
    if (resolved.length === 0) return ignored;
    return billingUpdated({
      eventId,
      providerType,
      customerId,
      subscriptionId: referenceId(object.id),
      status: resolved,
    });
  }

  return billingUpdated({
    eventId,
    providerType,
    customerId,
    subscriptionId: invoiceSubscriptionId(object),
    status:
      status.length > 0 ? status : providerType === 'invoice.paid' ? 'paid' : 'payment_failed',
  });
}

function toPaymentEvent(event: unknown): PaymentEvent {
  if (!isRecord(event) || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw invalid('Webhook body is not a Stripe event');
  }
  const eventId = event.id;
  const providerType = event.type;
  if (SUBSCRIPTION_TYPES.has(providerType) || INVOICE_TYPES.has(providerType)) {
    return toBillingEvent(event, eventId, providerType);
  }
  if (!COMPLETED_TYPES.has(providerType)) return { type: 'ignored', eventId, providerType };

  const session = isRecord(event.data) ? event.data.object : undefined;
  if (!isRecord(session) || typeof session.id !== 'string') {
    throw invalid('Checkout event without a session object');
  }
  if (session.payment_status !== 'paid') return { type: 'ignored', eventId, providerType };

  const metadata = isRecord(session.metadata) ? session.metadata : {};
  // Sessions created outside Pocketkey top-ups (other products on the same account).
  if (metadata.appId === undefined) return { type: 'ignored', eventId, providerType };

  const appId = metadata.appId;
  if (typeof appId !== 'string' || appId.length === 0) {
    throw invalid('Checkout session metadata.appId is invalid');
  }
  const declared = metadata.amountCents;
  if (typeof declared !== 'string' || !/^[1-9]\d{0,14}$/.test(declared)) {
    throw invalid('Checkout session metadata.amountCents is missing or invalid');
  }
  const amountTotal = session.amount_total;
  if (typeof amountTotal !== 'number' || !Number.isSafeInteger(amountTotal)) {
    throw invalid('Checkout session amount_total is missing');
  }
  if (amountTotal !== Number(declared)) {
    throw invalid(
      `Checkout session amount_total ${amountTotal} does not match metadata amountCents ${declared}`,
    );
  }
  if (session.currency !== undefined && session.currency !== 'usd') {
    throw invalid('Checkout session currency must be usd');
  }
  return {
    type: 'topup.completed',
    eventId,
    appId,
    amountCents: amountTotal,
    checkoutId: session.id,
  };
}

/**
 * Verifies a Stripe webhook (HMAC-SHA256 of `${t}.${payload}`, any v1 may match,
 * timestamp within the tolerance) and maps it to a `PaymentEvent`.
 * `now` is in milliseconds since the epoch.
 */
export async function verifyStripeWebhook(input: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
  now: number;
  toleranceSeconds: number;
}): Promise<PaymentEvent> {
  if (!input.signatureHeader) {
    throw new PaymentsError('invalid_signature', 'Missing Stripe-Signature header');
  }
  const { timestamp, signatures } = parseSignatureHeader(input.signatureHeader);
  const expected = await hmacHex(input.secret, `${timestamp}.${input.payload}`);
  let matched = false;
  for (const signature of signatures) {
    // No short-circuit: every candidate is compared.
    matched = timingSafeEqualHex(expected, signature) || matched;
  }
  if (!matched) {
    throw new PaymentsError('invalid_signature', 'No Stripe signature matches the payload');
  }
  if (Math.abs(Math.floor(input.now / 1000) - timestamp) > input.toleranceSeconds) {
    throw new PaymentsError(
      'stale_signature',
      'Stripe signature timestamp is outside the tolerance',
    );
  }

  let event: unknown;
  try {
    event = JSON.parse(input.payload);
  } catch (cause) {
    throw new PaymentsError('invalid_payload', 'Webhook body is not valid JSON', { cause });
  }
  return toPaymentEvent(event);
}
