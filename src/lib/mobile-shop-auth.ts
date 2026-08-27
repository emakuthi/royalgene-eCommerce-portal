import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { assertTenantMatch } from '@/lib/tenant-guard';
import logger from '@/lib/logger';

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
 * still need a real row to point at. PortalUser.userId is UNIQUE (one row
 * per user, not per shop), so reuse the admin's existing row if any, and
 * otherwise lazily provision one scoped to the shop they're acting on.
 */
async function resolveAdminPortalUserId(
  userId: string,
  shopId: string,
  organizationId: string,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('PortalUser')
    .select('id')
    .eq('userId', userId)
    .maybeSingle();

  if (existing) return existing.id;

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
    // Extremely unlikely race (another request just created the row) —
    // re-read rather than fail the caller's request.
    const { data: raced } = await supabaseAdmin
      .from('PortalUser')
      .select('id')
      .eq('userId', userId)
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

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  const isAdmin =
    payload.role === 'admin' || payload.role === 'super_admin';

  // Admins / super-admins bypass the PortalUser membership check, but an org
  // "admin" is still tenant-scoped — they only bypass it for shops in their
  // OWN organization. Only true super_admin (no organizationId) bypasses
  // unconditionally. Either way we need the shop's organizationId: it's
  // required to lazily provision a PortalUser row below.
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

