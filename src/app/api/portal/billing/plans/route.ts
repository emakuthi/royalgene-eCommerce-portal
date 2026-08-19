import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listPlans } from '@/lib/billing-plans.server';

// GET /api/portal/billing/plans — active plans, any authenticated portal user (viewing pricing isn't admin-only).
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const plans = await listPlans(true);
  return jsonResponse({ success: true, data: plans });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
