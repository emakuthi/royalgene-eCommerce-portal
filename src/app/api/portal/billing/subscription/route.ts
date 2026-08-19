import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getActiveSubscription } from '@/lib/entitlements/entitlement-service.server';
import { expireTrialIfLapsed } from '@/lib/entitlements/subscription-status.server';

// GET /api/portal/billing/subscription — the caller's own TenantSubscription + resolved plan.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  await expireTrialIfLapsed(auth.organizationId);
  const ctx = await getActiveSubscription(auth.organizationId);
  if (!ctx) return jsonResponse({ success: false, error: 'Organization not found' }, 404);

  return jsonResponse({
    success: true,
    data: {
      subscription: ctx.subscription,
      plan: ctx.plan,
      isLegacyUnlimited: ctx.isLegacyUnlimited,
      isRestricted: ctx.isRestricted,
    },
  });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
