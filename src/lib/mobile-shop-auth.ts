import { NextRequest } from 'next/server';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';

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

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  // Admins / super-admins bypass the PortalUser check – they can access ANY shop
  if (isAdmin) {
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

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  return { payload, isAdmin };
}

