import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { buildPnlTrend } from '@/lib/pnl.server';
import { canViewCostData } from '@/lib/cost-visibility.server';

// GET /api/portal/analytics/pnl[?shopId=&months=6]
// Monthly profit-and-loss (revenue / gross / expenses / net) in the tenant base
// currency. Also accepts mobile JWTs (requireTenantUser).
//
// Profit figures are owner/admin-only (same gate as cost data) — a non-privileged
// caller gets an empty series rather than any gross/net numbers.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  if (!(await canViewCostData(auth))) return jsonResponse({ success: true, data: [] });
  const p = request.nextUrl.searchParams;
  const data = await buildPnlTrend(auth.organizationId, {
    shopId: p.get('shopId') || undefined,
    months: p.get('months') ? Number(p.get('months')) : undefined,
  });
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
