import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listEntitlementsForPlan, upsertPlanEntitlements, type EntitlementPatch } from '@/lib/entitlements/plan-entitlements.server';

// GET /api/platform/plans/[id]/entitlements — every feature/limit row for a plan, super_admin only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const entitlements = await listEntitlementsForPlan(id);
  return jsonResponse({ success: true, data: entitlements });
}

// PATCH /api/platform/plans/[id]/entitlements — { patches: [{code, enabled?, limitValue?}] }, super_admin only.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();
  const patches = Array.isArray(body?.patches) ? (body.patches as EntitlementPatch[]) : null;

  if (!patches || patches.length === 0 || patches.some((p) => !p.code)) {
    return jsonResponse({ success: false, error: 'patches: [{code, enabled?, limitValue?}] is required' }, 400);
  }

  try {
    const updated = await upsertPlanEntitlements(id, patches);
    return jsonResponse({ success: true, data: updated });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to update entitlements' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
