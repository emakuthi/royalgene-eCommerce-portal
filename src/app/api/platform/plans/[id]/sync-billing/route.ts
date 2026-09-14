import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { ensurePaystackPlanCodes } from '@/lib/billing-plans.server';

// POST /api/platform/plans/[id]/sync-billing — mint any MISSING Paystack
// plan codes for this plan (e.g. it was created before PAYSTACK_SECRET_KEY
// was configured). Never touches a code that already exists. super_admin only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const plan = await ensurePaystackPlanCodes(id);
    if (!plan) return jsonResponse({ success: false, error: 'Plan not found' }, 404);
    const stillMissing = !plan.paystackMonthlyPlanCode || !plan.paystackAnnualPlanCode;
    return jsonResponse({
      success: true,
      data: plan,
      message: stillMissing
        ? 'Paystack is not configured (or the mint call failed) — codes still missing. Check PAYSTACK_SECRET_KEY and try again.'
        : 'Plan codes synced.',
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to sync billing codes' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
