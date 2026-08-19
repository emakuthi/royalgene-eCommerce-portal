import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { createPlan, listPlans } from '@/lib/billing-plans.server';

const VALID_TIERS = ['starter', 'business', 'pro', 'enterprise'];

// GET /api/platform/plans — every plan (active + inactive), super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const plans = await listPlans(false);
  return jsonResponse({ success: true, data: plans });
}

// POST /api/platform/plans — create a plan (also mints Paystack plan codes), super_admin only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { tier, code, name, description, monthlyPriceKobo, annualPriceKobo, monthlyPriceUSD, annualPriceUSD, maxShops, maxUsers, displayOrder } = body;

  if (!tier || !VALID_TIERS.includes(tier)) {
    return jsonResponse({ success: false, error: `tier must be one of: ${VALID_TIERS.join(', ')}` }, 400);
  }
  if (!name || typeof name !== 'string') {
    return jsonResponse({ success: false, error: 'name is required' }, 400);
  }
  if (!Number.isFinite(monthlyPriceKobo) || monthlyPriceKobo < 0 || !Number.isFinite(annualPriceKobo) || annualPriceKobo < 0) {
    return jsonResponse({ success: false, error: 'monthlyPriceKobo and annualPriceKobo must be non-negative numbers' }, 400);
  }

  try {
    const plan = await createPlan({
      tier,
      code: code ?? null,
      name,
      description: description ?? null,
      monthlyPriceKobo,
      annualPriceKobo,
      monthlyPriceUSD: monthlyPriceUSD ?? null,
      annualPriceUSD: annualPriceUSD ?? null,
      maxShops: maxShops ?? null,
      maxUsers: maxUsers ?? null,
      displayOrder: displayOrder ?? 0,
    });
    return jsonResponse({ success: true, data: plan }, 201);
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to create plan' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
