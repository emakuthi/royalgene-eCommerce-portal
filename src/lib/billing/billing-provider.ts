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

export interface ChangePlanInput {
  /** The tenant's existing provider-side subscription, if any (none yet during trial). */
  subscriptionCode?: string | null;
  emailToken?: string | null;
}

export interface ChangePlanResult {
  /**
   * Paystack has no "update this subscription's plan in place" API — the
   * only way to move a tenant to a different plan is to cancel whatever
   * they're on (if anything) and have them complete a fresh checkout for
   * the new plan's price. Every provider implementation is expected to be
   * honest about this rather than pretend an in-place update happened;
   * `requiresNewCheckout` is always true today because no wired provider
   * supports otherwise.
   */
  requiresNewCheckout: true;
}

export interface RecordUsageInput {
  organizationId: string;
  limitCode: string;
  quantity: number;
}

export interface InvoiceLineItem {
  limitCode: string;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  subtotalKobo: number;
}

export interface GeneratedInvoice {
  organizationId: string;
  period: string;
  basePriceKobo: number;
  overageKobo: number;
  totalKobo: number;
  currency: string;
  lineItems: InvoiceLineItem[];
}

export interface BillingProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<{ ok: true; data: CreateCheckoutResult } | { ok: false; error: string }>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | { ok: false; error: string }>;
  getSubscription(reference: string): Promise<{ ok: true; data: ProviderSubscriptionStatus } | { ok: false; error: string }>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  /** See ChangePlanResult — always resolves to "go start a new checkout" until a provider genuinely supports in-place plan changes. */
  changePlan(input: ChangePlanInput): Promise<{ ok: true; data: ChangePlanResult } | { ok: false; error: string }>;
  /**
   * No wired provider today has a metered-usage API to report to (Paystack
   * is fixed-subscription only) — overage is tracked entirely locally
   * (entitlements/overage.server.ts) and settled through a normal checkout
   * for the invoice total, not reported to the provider in real time. This
   * is an intentional no-op for every current provider, kept on the
   * interface for a future metered-billing provider (e.g. Stripe Billing).
   */
  recordUsage(input: RecordUsageInput): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Provider-agnostic — every provider computes the same way (base plan price + local overage), only payment collection differs. */
  generateInvoice(organizationId: string, period?: string): Promise<{ ok: true; data: GeneratedInvoice } | { ok: false; error: string }>;
}
