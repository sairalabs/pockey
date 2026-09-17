export type PaymentEvent =
  | {
      type: 'topup.completed';
      /** Provider event id, for idempotent processing. */
      eventId: string;
      appId: string;
      amountCents: number;
      checkoutId: string;
    }
  | {
      /**
       * Subscription or invoice change on the usage based plan (section 11). The
       * caller mirrors `status` on the developer row; nothing is charged here.
       */
      type: 'billing.updated';
      eventId: string;
      customerId: string;
      subscriptionId?: string;
      /** Stripe subscription status, or the invoice status for invoice events. */
      status: string;
      providerType: string;
    }
  | { type: 'ignored'; eventId: string; providerType: string };

export interface TopUpCheckoutRequest {
  appId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/** Stripe customer backing a developer account. */
export interface BillingCustomer {
  customerId: string;
  email: string;
}

/** Usage based subscription of a developer, one metered item (section 11). */
export interface BillingSubscription {
  subscriptionId: string;
  status: string;
  /** ISO 8601, null when Stripe exposes no period end for the item. */
  currentPeriodEnd: string | null;
  /** Billing meter id behind the metered price, null when the price exposes none. */
  meterId: string | null;
}

export interface MeterEvent {
  /** Idempotency key, e.g. `maw:<developerId>:<YYYY-MM-DD>` */
  identifier: string;
  value: number;
  timestampSeconds?: number;
}

export interface EnsureCustomerInput {
  developerId: string;
  email: string;
  name?: string;
  /** Customer id already stored for this developer. Reused when it still exists. */
  existingCustomerId?: string;
}

export interface EnsureUsageSubscriptionInput {
  customerId: string;
  /** Subscription id already stored. Reused when it is active or trialing. */
  existingSubscriptionId?: string;
  /** Written to `metadata[developerId]` when a subscription is created. */
  developerId?: string;
}

/** Payments port (T4.6 top-ups, T5.4 billing): prepaid gas sponsoring and usage based billing. */
export interface Payments {
  createTopUpCheckout(input: TopUpCheckoutRequest): Promise<{ checkoutId: string; url: string }>;
  /** `now` is in milliseconds since the epoch (defaults to `Date.now()`). */
  parseWebhook(input: {
    payload: string;
    signatureHeader: string | null;
    now?: number;
  }): Promise<PaymentEvent>;
  /** Reuses `existingCustomerId` when it still exists, otherwise creates a customer. */
  ensureCustomer(input: EnsureCustomerInput): Promise<BillingCustomer>;
  /** Reuses `existingSubscriptionId` when it is active or trialing, otherwise subscribes. */
  ensureUsageSubscription(input: EnsureUsageSubscriptionInput): Promise<BillingSubscription>;
  /**
   * Reports monthly active wallets to the Stripe billing meter. The caller sends one
   * event per developer per day carrying that day's active wallet count, keyed by
   * `identifier`. Resending the same identifier is safe: Stripe deduplicates on it
   * over a rolling window of at least 24 hours.
   */
  recordActiveWallets(input: { customerId: string; event: MeterEvent }): Promise<void>;
  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}
