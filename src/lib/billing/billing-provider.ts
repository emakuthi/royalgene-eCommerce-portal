import 'server-only';

/**
 * Extension point for future payment providers (M-Pesa recurring, Stripe,
 * Flutterwave, Pesapal, ...). Existing checkout/verify/webhook routes under
 * src/app/api/portal/billing/* and src/app/api/webhooks/paystack were left
 * untouched (proven, already tested against real Paystack quirks) — this
 * interface is used by new code going forward, starting with cancellation.
 */

export interface CreateCheckoutInput {
  email: string;
  amountKobo: number;
  currency?: string;
  planCode?: string | null;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutResult {
  checkoutUrl: string;
  reference: string;
}

export interface CancelSubscriptionInput {
  subscriptionCode: string;
  /** Paystack requires the subscription's email token, obtained from a prior fetch — passed through opaquely. */
  emailToken?: string | null;
}

export interface ProviderSubscriptionStatus {
  status: string;
  reference?: string | null;
}

export interface BillingProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<{ ok: true; data: CreateCheckoutResult } | { ok: false; error: string }>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | { ok: false; error: string }>;
  getSubscription(reference: string): Promise<{ ok: true; data: ProviderSubscriptionStatus } | { ok: false; error: string }>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
}
