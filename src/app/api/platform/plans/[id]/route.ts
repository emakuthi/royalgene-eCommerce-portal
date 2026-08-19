import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updatePlan } from '@/lib/billing-plans.server';

// PATCH /api/platform/plans/[id] — update non-price fields, super_admin only.
// Price is intentionally not editable here — see billing-plans.server.ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name, description, maxShops, maxUsers, isActive, displayOrder } = await request.json();

  try {
    const plan = await updatePlan(id, { name, description, maxShops, maxUsers, isActive, displayOrder });
    if (!plan) return jsonResponse({ success: false, error: 'Plan not found' }, 404);
    return jsonResponse({ success: true, data: plan });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to update plan' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
