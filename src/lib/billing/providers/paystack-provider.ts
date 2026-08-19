import 'server-only';
import type { BillingProvider, CancelSubscriptionInput, CreateCheckoutInput, CreateCheckoutResult, ProviderSubscriptionStatus } from '../billing-provider';
import {
  disableSubscription,
  fetchSubscription,
  initializeTransaction,
  isPaystackConfigured,
  verifyTransaction,
  verifyWebhookSignature,
} from '../../paystack.server';

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
};
