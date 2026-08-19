import { NextRequest } from 'next/server';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { assertTenantMatch } from '@/lib/tenant-guard';

/**
 * Result of a successful mobile auth + shop access check.
 */
export interface MobileShopAuth {
  payload: VerifiedPayload;
  /** True when the user is admin / super_admin */
  isAdmin: boolean;
  /**
   * The portal-user ID linked to this shop.
   * For admins without a PortalUser row it is a synthetic id like `admin-<userId>`.
   */
  portalUserId: string;
}

/**
 * Authenticate a mobile request AND verify that the caller has access
 * to the given shop.
 *
 * - **admin / super_admin** users are always granted access to every shop.
 * - **portal_user** users must have an active PortalUser row for the shop.
 *
 * Returns either a `MobileShopAuth` on success, or a `NextResponse`
 * (401/403) that the caller should return immediately.
 */
export async function verifyMobileShopAccess(
  request: NextRequest,
  shopId: string,
): Promise<MobileShopAuth | Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return jsonResponse(
      { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
      401,
    );
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse(
      { success: false, error: 'Invalid token', code: 'UNAUTHORIZED' },
      401,
    );
  }

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  // Admins / super-admins bypass the PortalUser membership check, but an org
  // "admin" is still tenant-scoped — they only bypass it for shops in their
  // OWN organization. Only true super_admin (no organizationId) bypasses
  // unconditionally.
  if (isAdmin) {
    if (payload.organizationId) {
      const { data: shopCheck } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('id', shopId)
        .eq('organizationId', payload.organizationId)
        .maybeSingle();
      if (!shopCheck) {
        return jsonResponse(
          { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
          403,
        );
      }
    }
    return {
      payload,
      isAdmin: true,
      portalUserId: `admin-${payload.userId}`,
    };
  }

  // Regular portal users must have a PortalUser row for this shop
  const { data: portalUser, error: portalError } = await supabaseAdmin
    .from('PortalUser')
    .select('id, shopId')
    .eq('userId', payload.userId)
    .eq('shopId', shopId)
    .single();

  if (portalError || !portalUser) {
    return jsonResponse(
      { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
      403,
    );
  }

  return {
    payload,
    isAdmin: false,
    portalUserId: portalUser.id,
  };
}

/**
 * Lightweight auth-only check (no shop scope).
 * Returns the decoded payload or an error response.
 */
export function verifyMobileAuth(
  request: NextRequest,
): { payload: VerifiedPayload; isAdmin: boolean } | Response {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return jsonResponse(
      { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
      401,
    );
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse(
      { success: false, error: 'Invalid token', code: 'UNAUTHORIZED' },
      401,
    );
  }

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  return { payload, isAdmin };
}

