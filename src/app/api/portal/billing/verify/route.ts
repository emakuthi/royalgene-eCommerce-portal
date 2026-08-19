import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyTransaction } from '@/lib/paystack.server';
import { getPlanById } from '@/lib/billing-plans.server';
import { applySuccessfulSubscription } from '@/lib/billing.server';
import { getOrganizationById } from '@/lib/organizations.server';

// GET /api/portal/billing/verify?reference=... — called when the browser
// returns from Paystack checkout, in case the webhook hasn't landed yet.
// Idempotent: applySuccessfulSubscription no-ops if already processed.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const reference = request.nextUrl.searchParams.get('reference');
  if (!reference) return jsonResponse({ success: false, error: 'reference is required' }, 400);

  const result = await verifyTransaction(reference);
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 502);

  const { data: txn } = result;
  if (txn.status !== 'success') {
    return jsonResponse({ success: true, data: { status: txn.status } });
  }

  const metadata = txn.metadata || {};
  const organizationId = typeof metadata.organizationId === 'string' ? metadata.organizationId : null;
  const planId = typeof metadata.planId === 'string' ? metadata.planId : null;
  const interval = metadata.interval === 'annually' ? 'annually' : 'monthly';

  if (!organizationId || !planId) {
    return jsonResponse({ success: false, error: 'Transaction is missing plan metadata' }, 502);
  }
  if (auth.role !== 'super_admin' && auth.organizationId !== organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  const plan = await getPlanById(planId);
  if (!plan) return jsonResponse({ success: false, error: 'Plan not found' }, 404);

  await applySuccessfulSubscription({
    organizationId,
    plan,
    interval,
    reference,
    paystackCustomerCode: txn.customer?.customer_code ?? null,
    paystackSubscriptionCode: txn.subscription_code ?? null,
  });

  const organization = await getOrganizationById(organizationId);
  return jsonResponse({ success: true, data: { status: 'success', organization } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
