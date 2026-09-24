import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getTenantEntitlementSummary } from '@/lib/entitlements/entitlement-service.server';
import {
  listEntitlementOverridesForOrg,
  upsertOrgEntitlementOverrides,
  deleteOrgEntitlementOverride,
  type OrgEntitlementPatch,
} from '@/lib/entitlements/org-entitlement-overrides.server';

// Only these limit codes ship with an override editor for now — the table
// itself is generic, but the UI/API surface stays scoped to what's built.
const OVERRIDABLE_CODES = new Set(['STORAGE_GB', 'PRODUCTS', 'USERS']);

// GET /api/platform/organizations/[id]/entitlements — this org's override rows
// plus its live effective usage/limit snapshot, super_admin only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const [overrides, summary] = await Promise.all([listEntitlementOverridesForOrg(id), getTenantEntitlementSummary(id)]);
  return jsonResponse({ success: true, data: { overrides, effective: summary.limits } });
}

// PATCH /api/platform/organizations/[id]/entitlements — { patches: [{code, limitValue}] }, super_admin only.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();
  const patches = Array.isArray(body?.patches) ? (body.patches as OrgEntitlementPatch[]) : null;

  if (!patches || patches.length === 0 || patches.some((p) => !p.code || !OVERRIDABLE_CODES.has(p.code))) {
    return jsonResponse({ success: false, error: `patches: [{code, limitValue}] is required; code must be one of ${[...OVERRIDABLE_CODES].join(', ')}` }, 400);
  }

  try {
    const updated = await upsertOrgEntitlementOverrides(id, patches);
    return jsonResponse({ success: true, data: updated });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to update entitlement overrides' }, 500);
  }
}

// DELETE /api/platform/organizations/[id]/entitlements — { code } resets that limit to the plan default.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();
  const code = typeof body?.code === 'string' ? body.code : null;

  if (!code || !OVERRIDABLE_CODES.has(code)) {
    return jsonResponse({ success: false, error: `code is required and must be one of ${[...OVERRIDABLE_CODES].join(', ')}` }, 400);
  }

  try {
    await deleteOrgEntitlementOverride(id, code);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to reset entitlement override' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
