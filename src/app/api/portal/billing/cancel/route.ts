import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getOrganizationById } from '@/lib/organizations.server';
import { cancelSubscription } from '@/lib/entitlements/subscription-status.server';
import { getBillingProvider } from '@/lib/billing/get-billing-provider';
import { fetchCustomerId, listCustomerSubscriptions } from '@/lib/paystack.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';

// POST /api/portal/billing/cancel — org admin cancels their own subscription.
// Data and account access are preserved; only future premium usage is restricted
// (see entitlement-service.server.ts's isRestricted handling).
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const organization = await getOrganizationById(auth.organizationId);
  if (!organization) return jsonResponse({ success: false, error: 'Organization not found' }, 404);

  const provider = getBillingProvider();
  // The subscription code arrives only on Paystack's subscription.create
  // webhook; if that was missed, find the customer's live subscriptions so
  // cancelling really stops the card being charged.
  const codes = organization.paystackSubscriptionCode
    ? [organization.paystackSubscriptionCode]
    : await renewingSubscriptionCodes(organization.paystackCustomerCode);
  for (const subscriptionCode of codes) {
    const result = await provider.cancelSubscription({ subscriptionCode });
    if (!result.ok) {
      logger.warn('[billing] provider cancellation failed, proceeding with local cancel anyway', { error: result.error, organizationId: auth.organizationId });
    }
  }
  await supabaseAdmin
    .from('Organization')
    .update({ paystackSubscriptionCode: null, paystackPlanCode: null })
    .eq('id', auth.organizationId);

  const subscription = await cancelSubscription(auth.organizationId, auth.userId);
  return jsonResponse({ success: true, data: subscription });
}

async function renewingSubscriptionCodes(customerCode: string | null | undefined): Promise<string[]> {
  if (!customerCode) return [];
  const customerId = await fetchCustomerId(customerCode);
  if (customerId === null) return [];
  const result = await listCustomerSubscriptions(customerId);
  if (!result.ok) return [];
  return result.data.filter((s) => s.status === 'active' || s.status === 'attention').map((s) => s.subscription_code);
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
