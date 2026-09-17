export type PaymentEvent =
  | {
      type: 'topup.completed';
      /** Provider event id, for idempotent processing. */
      eventId: string;
      appId: string;
      amountCents: number;
      checkoutId: string;
    }
  | { type: 'ignored'; eventId: string; providerType: string };

export interface TopUpCheckoutRequest {
  appId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/** Payments port (T4.6): prepaid gas sponsoring top-ups. */
export interface Payments {
  createTopUpCheckout(input: TopUpCheckoutRequest): Promise<{ checkoutId: string; url: string }>;
  /** `now` is in milliseconds since the epoch (defaults to `Date.now()`). */
  parseWebhook(input: {
    payload: string;
    signatureHeader: string | null;
    now?: number;
  }): Promise<PaymentEvent>;
}
