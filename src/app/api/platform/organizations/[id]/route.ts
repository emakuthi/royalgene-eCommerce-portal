import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateOrganizationPlan, updateOrganizationStatus } from '@/lib/organizations.server';
import type { Organization } from '@/lib/types';

const VALID_STATUSES: Organization['status'][] = ['pending_verification', 'active', 'suspended', 'cancelled'];
const VALID_PLAN_TIERS: Organization['planTier'][] = ['free', 'starter', 'pro', 'enterprise', 'legacy'];

// PATCH /api/platform/organizations/[id] — { status?, planTier? }, super_admin only.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { status, planTier } = await request.json();

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return jsonResponse({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }
  if (planTier !== undefined && !VALID_PLAN_TIERS.includes(planTier)) {
    return jsonResponse({ success: false, error: `Invalid planTier. Must be one of: ${VALID_PLAN_TIERS.join(', ')}` }, 400);
  }
  if (status === undefined && planTier === undefined) {
    return jsonResponse({ success: false, error: 'Provide status and/or planTier' }, 400);
  }

  try {
    let organization: Organization | null = null;
    if (status !== undefined) organization = await updateOrganizationStatus(id, status);
    if (planTier !== undefined) organization = await updateOrganizationPlan(id, planTier);
    if (!organization) return jsonResponse({ success: false, error: 'Organization not found' }, 404);
    return jsonResponse({ success: true, data: organization });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Update failed' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
