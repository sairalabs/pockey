import { FREE_MONTHLY_ACTIVE_WALLETS, PRICE_CENTS_PER_ACTIVE_WALLET } from '@pockey/types';
import { PaymentsError } from './errors.js';
import type {
  BillingSubscription,
  EnsureCustomerInput,
  EnsureUsageSubscriptionInput,
  MeterEvent,
} from './types.js';

/**
 * Billing shared by the Stripe and mock implementations: price math, request
 * bodies and response mapping for the usage based plan of section 11.
 */

/** Subscription statuses that count as a live usage based plan, so no new one is created. */
export const ACTIVE_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing'];

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/**
 * What a month of `activeWallets` costs, in cents: the free allowance is deducted
 * first, the rest is billed per wallet (section 11, 500 included then 6 cents).
 * Single source of truth for the API and the dashboard. Never negative.
 */
export function estimateMonthlyCents(
  activeWallets: number,
  options?: { includedWallets?: number; unitPriceCents?: number },
): number {
  const included = nonNegativeInteger(options?.includedWallets ?? FREE_MONTHLY_ACTIVE_WALLETS);
  const unitPriceCents = nonNegative(options?.unitPriceCents ?? PRICE_CENTS_PER_ACTIVE_WALLET);
  const billable = nonNegativeInteger(activeWallets) - included;
  if (billable <= 0) return 0;
  return Math.round(billable * unitPriceCents);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PaymentsError('invalid_payload', `${field} is required`);
  }
}

export function assertEnsureCustomerInput(input: EnsureCustomerInput): void {
  assertId(input.developerId, 'developerId');
  if (typeof input.email !== 'string' || !input.email.includes('@')) {
    throw new PaymentsError('invalid_payload', 'email is required');
  }
}

export function assertEnsureSubscriptionInput(input: EnsureUsageSubscriptionInput): void {
  assertId(input.customerId, 'customerId');
}

export function assertMeterEvent(customerId: string, event: MeterEvent): void {
  assertId(customerId, 'customerId');
  assertId(event.identifier, 'event.identifier');
  if (!Number.isSafeInteger(event.value) || event.value < 0) {
    throw new PaymentsError('invalid_payload', 'event.value must be a non negative integer');
  }
  if (event.timestampSeconds !== undefined && !Number.isSafeInteger(event.timestampSeconds)) {
    throw new PaymentsError('invalid_payload', 'event.timestampSeconds must be an integer');
  }
}

export function assertPortalInput(input: { customerId: string; returnUrl: string }): void {
  assertId(input.customerId, 'customerId');
  if (!isHttpUrl(input.returnUrl)) {
    throw new PaymentsError('invalid_payload', 'returnUrl must be an http(s) URL');
  }
}

/** Form body of `POST /v1/customers`. */
export function customerForm(input: EnsureCustomerInput): URLSearchParams {
  const form = new URLSearchParams();
  form.set('email', input.email);
  if (input.name !== undefined && input.name.length > 0) form.set('name', input.name);
  form.set('metadata[developerId]', input.developerId);
  return form;
}

/** Form body of `POST /v1/subscriptions` for the single metered active wallet item. */
export function usageSubscriptionForm(input: {
  customerId: string;
  priceId: string;
  developerId?: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set('customer', input.customerId);
  form.set('items[0][price]', input.priceId);
  if (input.developerId !== undefined && input.developerId.length > 0) {
    form.set('metadata[developerId]', input.developerId);
  }
  return form;
}

/** Form body of `POST /v1/billing/meter_events`. */
export function meterEventForm(input: {
  eventName: string;
  customerId: string;
  event: MeterEvent;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set('event_name', input.eventName);
  form.set('payload[stripe_customer_id]', input.customerId);
  form.set('payload[value]', String(input.event.value));
  form.set('identifier', input.event.identifier);
  if (input.event.timestampSeconds !== undefined) {
    form.set('timestamp', String(input.event.timestampSeconds));
  }
  return form;
}

/** Form body of `POST /v1/billing_portal/sessions`. */
export function billingPortalForm(input: {
  customerId: string;
  returnUrl: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set('customer', input.customerId);
  form.set('return_url', input.returnUrl);
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const row of value as unknown[]) if (isRecord(row)) rows.push(row);
  return rows;
}

function isoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * `current_period_end` lives on the subscription up to API version 2025-03-31.basil
 * and on each subscription item from it onwards. Both are read, item first missing.
 */
function readPeriodEnd(subscription: Record<string, unknown>): string | null {
  const top = isoFromUnixSeconds(subscription.current_period_end);
  if (top !== null) return top;
  for (const item of toRecordArray(isRecord(subscription.items) ? subscription.items.data : null)) {
    const fromItem = isoFromUnixSeconds(item.current_period_end);
    if (fromItem !== null) return fromItem;
  }
  return null;
}

/** `price.recurring.meter` of the first metered item, when the price is expanded. */
function readMeterId(subscription: Record<string, unknown>): string | null {
  for (const item of toRecordArray(isRecord(subscription.items) ? subscription.items.data : null)) {
    const price = item.price;
    if (!isRecord(price) || !isRecord(price.recurring)) continue;
    const meter = price.recurring.meter;
    if (typeof meter === 'string' && meter.length > 0) return meter;
  }
  return null;
}

/** Maps a Stripe subscription body, or null when it is not one. */
export function readSubscription(body: unknown): BillingSubscription | null {
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.length === 0) return null;
  if (typeof body.status !== 'string' || body.status.length === 0) return null;
  return {
    subscriptionId: body.id,
    status: body.status,
    currentPeriodEnd: readPeriodEnd(body),
    meterId: readMeterId(body),
  };
}

/** Maps a Stripe customer body, or null when it is missing or deleted. */
export function readCustomer(body: unknown): { customerId: string; email: string | null } | null {
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.length === 0) return null;
  if (body.deleted === true) return null;
  return { customerId: body.id, email: typeof body.email === 'string' ? body.email : null };
}
