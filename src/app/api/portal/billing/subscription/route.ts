import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getActiveSubscription } from '@/lib/entitlements/entitlement-service.server';
import { expireTrialIfLapsed } from '@/lib/entitlements/subscription-status.server';
import { getOrganizationById } from '@/lib/organizations.server';

// GET /api/portal/billing/subscription — the caller's own TenantSubscription + resolved plan.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  await expireTrialIfLapsed(auth.organizationId);
  const [ctx, organization] = await Promise.all([
    getActiveSubscription(auth.organizationId),
    getOrganizationById(auth.organizationId),
  ]);
  if (!ctx) return jsonResponse({ success: false, error: 'Organization not found' }, 404);
  const org = organization as { paystackPlanCode?: string | null; billingStatus?: string | null; paidThrough?: string | null } | null;

  return jsonResponse({
    success: true,
    data: {
      subscription: ctx.subscription,
      plan: ctx.plan,
      isLegacyUnlimited: ctx.isLegacyUnlimited,
      isRestricted: ctx.isRestricted,
      // A card subscription renews by itself; anything else (M-Pesa, a trial, a lapsed
      // plan) is renewed by paying for the current plan again.
      autoRenews: Boolean(org?.paystackPlanCode && org?.billingStatus === 'active'),
      paidThrough: org?.paidThrough ?? null,
    },
  });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
