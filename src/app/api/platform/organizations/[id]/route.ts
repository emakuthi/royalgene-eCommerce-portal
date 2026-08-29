import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  purgeOrganization,
  softDeleteOrganization,
  updateOrganizationDetails,
  updateOrganizationPlan,
  updateOrganizationStatus,
} from '@/lib/organizations.server';
import type { Organization } from '@/lib/types';

const VALID_STATUSES: Organization['status'][] = ['pending_verification', 'active', 'suspended', 'cancelled'];
const VALID_PLAN_TIERS: Organization['planTier'][] = ['free', 'starter', 'business', 'pro', 'enterprise', 'legacy'];

// PATCH /api/platform/organizations/[id] — { name?, status?, planTier? }, super_admin only.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name, status, planTier } = await request.json();

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return jsonResponse({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }
  if (planTier !== undefined && !VALID_PLAN_TIERS.includes(planTier)) {
    return jsonResponse({ success: false, error: `Invalid planTier. Must be one of: ${VALID_PLAN_TIERS.join(', ')}` }, 400);
  }
  if (name !== undefined && typeof name !== 'string') {
    return jsonResponse({ success: false, error: 'name must be a string' }, 400);
  }
  if (name === undefined && status === undefined && planTier === undefined) {
    return jsonResponse({ success: false, error: 'Provide name, status and/or planTier' }, 400);
  }

  try {
    let organization: Organization | null = null;
    if (name !== undefined) organization = await updateOrganizationDetails(id, { name });
    if (status !== undefined) organization = await updateOrganizationStatus(id, status);
    if (planTier !== undefined) organization = await updateOrganizationPlan(id, planTier);
    if (!organization) return jsonResponse({ success: false, error: 'Organization not found' }, 404);
    return jsonResponse({ success: true, data: organization });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Update failed' }, 500);
  }
}

// DELETE /api/platform/organizations/[id] — soft delete by default; ?purge=true
// permanently removes all tenant data. Purge requires body { confirm: "<slug>" }.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const purge = request.nextUrl.searchParams.get('purge') === 'true';

  try {
    if (!purge) {
      const org = await softDeleteOrganization(id);
      if (!org) return jsonResponse({ success: false, error: 'Organization not found' }, 404);
      return jsonResponse({ success: true, data: org });
    }

    const body = await request.json().catch(() => ({}));
    const confirm = typeof body?.confirm === 'string' ? body.confirm : '';
    const result = await purgeOrganization(id, confirm);
    if (!result.ok) {
      const status = result.error.includes('not found') ? 404 : 400;
      return jsonResponse({ success: false, error: result.error }, status);
    }
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Delete failed' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
