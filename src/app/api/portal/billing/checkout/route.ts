import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getPlanById } from '@/lib/billing-plans.server';
import { getOrganizationById } from '@/lib/organizations.server';
import { initializeTransaction, isPaystackConfigured } from '@/lib/paystack.server';
import { getOrgUrl } from '@/lib/urls';

// POST /api/portal/billing/checkout — { planId, interval } -> Paystack checkout URL. Org admin only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!isPaystackConfigured()) {
    return jsonResponse({ success: false, error: 'Billing is not configured yet. Contact your platform administrator.' }, 503);
  }

  const { planId, interval } = await request.json();
  if (!planId || (interval !== 'monthly' && interval !== 'annually')) {
    return jsonResponse({ success: false, error: 'planId and interval ("monthly" | "annually") are required' }, 400);
  }

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const [plan, organization] = await Promise.all([
    getPlanById(planId),
    getOrganizationById(auth.organizationId),
  ]);
  if (!plan || !plan.isActive) return jsonResponse({ success: false, error: 'Plan not found' }, 404);
  if (!organization) return jsonResponse({ success: false, error: 'Organization not found' }, 404);

  const planCode = interval === 'annually' ? plan.paystackAnnualPlanCode : plan.paystackMonthlyPlanCode;
  if (!planCode) {
    return jsonResponse({ success: false, error: 'This plan is not fully configured for billing yet. Contact your platform administrator.' }, 503);
  }

  const amountKobo = interval === 'annually' ? plan.annualPriceKobo : plan.monthlyPriceKobo;
  const email = typeof auth.email === 'string' ? auth.email : undefined;
  if (!email) return jsonResponse({ success: false, error: 'No email on this account' }, 400);

  const result = await initializeTransaction({
    email,
    amountKobo,
    currency: plan.currency,
    planCode,
    callbackUrl: getOrgUrl(organization.slug, '/settings?tab=billing'),
    metadata: { organizationId: organization.id, planId: plan.id, interval },
  });

  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 502);

  return jsonResponse({ success: true, data: { checkoutUrl: result.data.authorizationUrl, reference: result.data.reference } });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
