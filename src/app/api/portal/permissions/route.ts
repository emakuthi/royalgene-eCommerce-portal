import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  EDITABLE_ROLES,
  PERMISSION_CATALOG,
  getEffectivePermissions,
  isCapability,
  setPermissionOverride,
  type EditableRole,
} from '@/lib/permissions.server';

/**
 * GET/PUT /api/portal/permissions — the "define permissions per role"
 * screen (portal settings + Android). Admin-only, same as
 * /api/portal/users/[id] — a shop_owner already has every capability
 * hardcoded (see permissions.server.ts) so has no need to edit this matrix,
 * only an "admin" (the workspace-owner account) does.
 */

export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
  }

  const matrix = await getEffectivePermissions(auth.organizationId);
  return jsonResponse({
    success: true,
    data: {
      roles: EDITABLE_ROLES,
      capabilities: PERMISSION_CATALOG,
      matrix,
    },
  });
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400); }
  const { role, permission, enabled } = body as { role?: unknown; permission?: unknown; enabled?: unknown };

  if (!(EDITABLE_ROLES as readonly string[]).includes(String(role))) {
    return jsonResponse({ success: false, error: `role must be one of ${EDITABLE_ROLES.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }
  if (!isCapability(permission)) {
    return jsonResponse({ success: false, error: 'Unknown permission', code: 'VALIDATION_ERROR' }, 400);
  }
  if (typeof enabled !== 'boolean') {
    return jsonResponse({ success: false, error: 'enabled must be a boolean', code: 'VALIDATION_ERROR' }, 400);
  }

  const result = await setPermissionOverride(auth.organizationId, role as EditableRole, permission, enabled);
  if (!result.ok) {
    return jsonResponse({ success: false, error: result.error, code: 'INTERNAL_ERROR' }, 500);
  }

  const matrix = await getEffectivePermissions(auth.organizationId);
  return jsonResponse({ success: true, data: { matrix }, message: 'Permission updated' });
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
