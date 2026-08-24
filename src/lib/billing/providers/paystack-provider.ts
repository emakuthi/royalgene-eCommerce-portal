import 'server-only';
import type {
  BillingProvider,
  CancelSubscriptionInput,
  ChangePlanInput,
  ChangePlanResult,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GeneratedInvoice,
  ProviderSubscriptionStatus,
  RecordUsageInput,
} from '../billing-provider';
import {
  disableSubscription,
  fetchSubscription,
  initializeTransaction,
  isPaystackConfigured,
  verifyTransaction,
  verifyWebhookSignature,
} from '../../paystack.server';
import { generateInvoice as generateInvoiceLocal } from '../../entitlements/overage.server';

export const paystackProvider: BillingProvider = {
  name: 'paystack',

  isConfigured: isPaystackConfigured,

  async createCheckout(input: CreateCheckoutInput): Promise<{ ok: true; data: CreateCheckoutResult } | { ok: false; error: string }> {
    const result = await initializeTransaction(input);
    if (!result.ok) return result;
    return { ok: true, data: { checkoutUrl: result.data.authorizationUrl, reference: result.data.reference } };
  },

  async cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | { ok: false; error: string }> {
    let emailToken = input.emailToken;
    if (!emailToken) {
      const sub = await fetchSubscription(input.subscriptionCode);
      if (!sub.ok) return sub;
      emailToken = sub.data.email_token;
    }
    return disableSubscription(input.subscriptionCode, emailToken);
  },

  async getSubscription(reference: string): Promise<{ ok: true; data: ProviderSubscriptionStatus } | { ok: false; error: string }> {
    const result = await verifyTransaction(reference);
    if (!result.ok) return result;
    return { ok: true, data: { status: result.data.status, reference: result.data.reference } };
  },

  verifyWebhookSignature,

  async changePlan(input: ChangePlanInput): Promise<{ ok: true; data: ChangePlanResult } | { ok: false; error: string }> {
    // No in-place plan-change API on Paystack — cancel whatever's active
    // (if anything) and hand back to the caller to start a fresh checkout.
    if (input.subscriptionCode) {
      const cancelResult = await this.cancelSubscription({ subscriptionCode: input.subscriptionCode, emailToken: input.emailToken });
      if (!cancelResult.ok) return cancelResult;
    }
    return { ok: true, data: { requiresNewCheckout: true } };
  },

  async recordUsage(_input: RecordUsageInput): Promise<{ ok: true } | { ok: false; error: string }> {
    // Intentional no-op — see the interface doc on BillingProvider.recordUsage.
    return { ok: true };
  },

  async generateInvoice(organizationId: string, period?: string): Promise<{ ok: true; data: GeneratedInvoice } | { ok: false; error: string }> {
    const invoice = await generateInvoiceLocal(organizationId, period);
    if (!invoice) return { ok: false, error: 'Could not generate invoice — no active plan for this organization.' };
    return {
      ok: true,
      data: {
        organizationId: invoice.organizationId,
        period: invoice.period,
        basePriceKobo: invoice.basePriceKobo,
        overageKobo: invoice.overageKobo,
        totalKobo: invoice.totalKobo,
        currency: invoice.currency,
        lineItems: invoice.breakdown ?? [],
      },
    };
  },
};
