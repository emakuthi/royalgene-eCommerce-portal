import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { assertTenantMatch } from '@/lib/tenant-guard';
import { isDeviceRevoked } from '@/lib/device-registry.server';
import logger from '@/lib/logger';

/**
 * A token with no `deviceId` claim (issued before device identity existed,
 * or a web-portal token that somehow reached a mobile-only route) is never
 * checked — nothing to look up. Only tokens the mobile app itself issued
 * with a device id are subject to remote revocation.
 */
async function rejectIfDeviceRevoked(payload: VerifiedPayload): Promise<Response | null> {
  if (!payload.deviceId) return null;
  if (await isDeviceRevoked(payload.userId, payload.deviceId)) {
    return jsonResponse(
      { success: false, error: 'This device has been signed out remotely. Please sign in again.', code: 'DEVICE_REVOKED' },
      401,
    );
  }
  return null;
}

/**
 * Result of a successful mobile auth + shop access check.
 */
export interface MobileShopAuth {
  payload: VerifiedPayload;
  /** True when the user is admin / super_admin */
  isAdmin: boolean;
  /** A real PortalUser.id — always safe to use as a FK value. */
  portalUserId: string;
}

/**
 * Admins/super_admins bypass the PortalUser membership check, but writes
 * (SalesEntry, StockTransaction, ...) have an FK to PortalUser.id, so we
 * still need a real row to point at. PortalUser.userId is NOT unique — the
 * DB's real constraint is UNIQUE(userId, shopId), and an admin who's been
 * added as a named member of one or more shops (on top of their org-wide
 * admin access) ends up with one PortalUser row per shop. So: prefer a row
 * already scoped to THIS shop; otherwise reuse any existing row (any of
 * them is an equally valid FK target — callers only need a real id, not a
 * shop-accurate one); otherwise lazily provision one scoped to this shop.
 *
 * Every read here uses `.limit(1)` instead of `.maybeSingle()`/`.single()` —
 * those error out (not just return null) when more than one row matches,
 * which a naive `.eq('userId', userId).maybeSingle()` used to hit for
 * exactly this multi-shop admin case, throwing 500s on this and every other
 * request while making an existing row look like it needed to be re-created.
 */
async function resolveAdminPortalUserId(
  userId: string,
  shopId: string,
  organizationId: string,
): Promise<string> {
  const { data: forThisShop } = await supabaseAdmin
    .from('PortalUser')
    .select('id')
    .eq('userId', userId)
    .eq('shopId', shopId)
    .limit(1)
    .maybeSingle();
  if (forThisShop) return forThisShop.id;

  const { data: anyExisting } = await supabaseAdmin
    .from('PortalUser')
    .select('id')
    .eq('userId', userId)
    .limit(1)
    .maybeSingle();
  if (anyExisting) return anyExisting.id;

  const now = new Date().toISOString();
  const newId = uuidv4();
  const { data: created, error } = await supabaseAdmin
    .from('PortalUser')
    .insert([{
      id: newId,
      userId,
      shopId,
      organizationId,
      position: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }])
    .select('id')
    .single();

  if (error || !created) {
    // Race: another request just created a row (for this shop or another)
    // between the reads above and this insert — re-read rather than fail.
    const { data: raced } = await supabaseAdmin
      .from('PortalUser')
      .select('id')
      .eq('userId', userId)
      .limit(1)
      .maybeSingle();
    if (raced) return raced.id;

    logger.error('Failed to lazily provision PortalUser for admin', {
      userId,
      shopId,
      error,
    });
    throw new Error('Failed to resolve admin portal-user id');
  }

  return created.id;
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

  const deviceRevoked = await rejectIfDeviceRevoked(payload);
  if (deviceRevoked) return deviceRevoked;

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  // A platform super_admin (no organizationId) has no tenant to be scoped to
  // and no business operating a shop — support goes through the platform
  // console, not the app.
  if (payload.role === 'super_admin' && !payload.organizationId) {
    return jsonResponse(
      { success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' },
      403,
    );
  }

  // Org admins bypass the PortalUser membership check, but only for shops in
  // their OWN organization (checked below). We need the shop's organizationId
  // regardless — it's required to lazily provision a PortalUser row.
  if (isAdmin) {
    const { data: shopRow } = await supabaseAdmin
      .from('Shop')
      .select('id, organizationId')
      .eq('id', shopId)
      .maybeSingle();

    if (!shopRow) {
      return jsonResponse(
        { success: false, error: 'Shop not found', code: 'NOT_FOUND' },
        404,
      );
    }

    if (payload.organizationId && shopRow.organizationId !== payload.organizationId) {
      return jsonResponse(
        { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
        403,
      );
    }

    try {
      const portalUserId = await resolveAdminPortalUserId(
        payload.userId,
        shopId,
        shopRow.organizationId,
      );
      return { payload, isAdmin: true, portalUserId };
    } catch {
      return jsonResponse(
        { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
        500,
      );
    }
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
export async function verifyMobileAuth(
  request: NextRequest,
): Promise<{ payload: VerifiedPayload; isAdmin: boolean } | Response> {
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

  const deviceRevoked = await rejectIfDeviceRevoked(payload);
  if (deviceRevoked) return deviceRevoked;

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  return { payload, isAdmin };
}

