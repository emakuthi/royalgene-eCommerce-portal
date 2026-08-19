import 'server-only';
import type { BillingProvider } from './billing-provider';
import { paystackProvider } from './providers/paystack-provider';

/** Swap point for a future provider — every tenant is on Paystack today. */
export function getBillingProvider(): BillingProvider {
  return paystackProvider;
}
