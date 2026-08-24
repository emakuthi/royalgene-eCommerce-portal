import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { generateInvoice } from '@/lib/entitlements/overage.server';

// GET /api/portal/billing/invoice — current billing period's invoice (base
// plan price + any overage), regenerated on each call so it stays live
// against current usage until the period is settled. For the caller's own
// organization only.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const invoice = await generateInvoice(auth.organizationId);
  if (!invoice) {
    return jsonResponse({ success: false, error: 'No active plan for this organization' }, 400);
  }

  return jsonResponse({ success: true, data: invoice });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
