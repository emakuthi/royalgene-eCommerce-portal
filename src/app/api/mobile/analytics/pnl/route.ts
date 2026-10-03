import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { buildPnlTrend } from '@/lib/pnl.server';
import { canViewCostData } from '@/lib/cost-visibility.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token ? verifyToken(token) : null;
}

// GET /api/mobile/analytics/pnl[?shopId=&months=6]
// Monthly profit-and-loss (revenue / gross / expenses / net) in the base currency.
// Owner/admin-only (same gate as cost data) — others get an empty series.
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!(await canViewCostData(payload))) return jsonResponse({ success: true, data: [] });
  const p = request.nextUrl.searchParams;
  const data = await buildPnlTrend(payload.organizationId, {
    shopId: p.get('shopId') || undefined,
    months: p.get('months') ? Number(p.get('months')) : undefined,
  });
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
