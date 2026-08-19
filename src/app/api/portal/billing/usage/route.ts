import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getTenantEntitlementSummary } from '@/lib/entitlements/entitlement-service.server';

// GET /api/portal/billing/usage — usage-vs-limit for every wired resource, for the caller's own organization.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const summary = await getTenantEntitlementSummary(auth.organizationId);
  return jsonResponse({ success: true, data: { limits: summary.limits, plan: summary.plan, subscription: summary.subscription } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
