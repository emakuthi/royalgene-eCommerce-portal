import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getOrganizationById } from '@/lib/organizations.server';
import { cancelSubscription } from '@/lib/entitlements/subscription-status.server';
import { getBillingProvider } from '@/lib/billing/get-billing-provider';
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

  if (organization.paystackSubscriptionCode) {
    const provider = getBillingProvider();
    const result = await provider.cancelSubscription({ subscriptionCode: organization.paystackSubscriptionCode });
    if (!result.ok) {
      logger.warn('[billing] provider cancellation failed, proceeding with local cancel anyway', { error: result.error, organizationId: auth.organizationId });
    }
  }

  const subscription = await cancelSubscription(auth.organizationId, auth.userId);
  return jsonResponse({ success: true, data: subscription });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
