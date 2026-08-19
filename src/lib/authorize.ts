import { NextRequest, NextResponse } from 'next/server';
// NOTE: import from './auth.server', not './auth' — the latter re-exports the
// client-safe decodeJwt-based verifyToken(), which does NOT verify the JWT
// signature. Using it here would let a caller forge any payload (including
// organizationId), defeating the tenant cross-check below entirely.
import { extractTokenFromHeader, verifyToken, VerifiedPayload } from './auth.server';
import { supabaseAdmin } from './supabase-client';
import type { PortalUser } from './types';
import { jsonResponse } from './apiResponse';
import { assertTenantMatch } from './tenant-guard';

/**
 * Basic auth helpers for Next.js route handlers.
 * Each helper returns either a VerifiedPayload (on success) or a NextResponse (to return directly from the route).
 */

export function requireAuth(request: NextRequest): VerifiedPayload | NextResponse {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || null;
  const token = extractTokenFromHeader(authHeader ?? null);
  if (!token) {
    return jsonResponse({ success: false, error: 'Authentication required' }, 401) as unknown as NextResponse;
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse({ success: false, error: 'Invalid token' }, 401) as unknown as NextResponse;
  }

  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;

  return payload;
}

export function requireRole(request: NextRequest, allowed: string[] = ['admin']): VerifiedPayload | NextResponse {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const payload = auth as VerifiedPayload;
  // super_admin always allowed
  if (payload.role === 'super_admin') return payload;

  if (typeof payload.role === 'string' && allowed.includes(payload.role)) return payload;

  return jsonResponse({ success: false, error: 'Admin access required' }, 403) as unknown as NextResponse;
}

export async function requirePortalRole(request: NextRequest, shopId: string, allowedPortalRoles: string[] = ['shopkeeper', 'shop_manager', 'shop_owner']): Promise<{ portalUser: PortalUser } | NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const payload = auth as VerifiedPayload;

  // super_admin bypass
  if (payload.role === 'super_admin') {
    const superAdminPortalUser: PortalUser = {
      id: `admin-${payload.userId}`,
      userId: payload.userId,
      shopId: shopId,
      position: 'shop_manager',
      isActive: true,
      mobileAccess: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { portalUser: superAdminPortalUser };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .eq('shopId', shopId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('requirePortalRole: supabase error', error);
      return jsonResponse({ success: false, error: 'Authorization lookup failed' }, 500) as unknown as NextResponse;
    }

    if (!data) {
      return jsonResponse({ success: false, error: 'Forbidden: not a portal user for this shop' }, 403) as unknown as NextResponse;
    }

    if (!allowedPortalRoles.includes(data.role)) {
      return jsonResponse({ success: false, error: 'Forbidden: insufficient portal role' }, 403) as unknown as NextResponse;
    }

    return { portalUser: data as PortalUser };
  } catch (err) {
    console.warn('requirePortalRole error', err);
    return jsonResponse({ success: false, error: 'Authorization failure' }, 500) as unknown as NextResponse;
  }
}

export async function requirePermission(request: NextRequest, permissionName: string): Promise<VerifiedPayload | NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const payload = auth as VerifiedPayload;
  // super_admin bypass
  if (payload.role === 'super_admin') return payload;

  try {
    // Resolve permissions by joining user_roles -> role_permissions -> permissions
    const { data, error } = await supabaseAdmin.rpc('get_user_permissions', { p_user_id: payload.userId });
    // Note: If you don't have an RPC, fallback to manual query
    if (error || !data) {
      // fallback manual query
      const q = await supabaseAdmin
        .from('user_roles as ur')
        .select('role_id')
        .eq('user_id', payload.userId);
      if (q.error) {
        console.warn('requirePermission: failed to fetch user roles', q.error);
        return jsonResponse({ success: false, error: 'Authorization lookup failed' }, 500) as unknown as NextResponse;
      }
      const roleIds = (q.data || []).map((r: { role_id: string }) => r.role_id);
      if (!roleIds || roleIds.length === 0) {
        return jsonResponse({ success: false, error: 'Forbidden: no roles' }, 403) as unknown as NextResponse;
      }

      const permsQuery = await supabaseAdmin
        .from('role_permissions as rp')
        .select('permission_id')
        .in('role_id', roleIds);
      if (permsQuery.error) {
        console.warn('requirePermission: failed to fetch role permissions', permsQuery.error);
        return jsonResponse({ success: false, error: 'Authorization lookup failed' }, 500) as unknown as NextResponse;
      }
      const permIds = (permsQuery.data || []).map((p: { permission_id: string }) => p.permission_id);
      if (!permIds || permIds.length === 0) {
        return jsonResponse({ success: false, error: 'Forbidden: no permissions' }, 403) as unknown as NextResponse;
      }

      const permNameQuery = await supabaseAdmin
        .from('permissions')
        .select('name')
        .in('id', permIds)
        .eq('name', permissionName);

      if (permNameQuery.error) {
        console.warn('requirePermission: failed to fetch permission names', permNameQuery.error);
        return jsonResponse({ success: false, error: 'Authorization lookup failed' }, 500) as unknown as NextResponse;
      }

      const has = (permNameQuery.data || []).length > 0;
      if (!has) return jsonResponse({ success: false, error: 'Forbidden: missing permission' }, 403) as unknown as NextResponse;

      return payload;
    }

    // If RPC returned data, check membership
    if (Array.isArray(data) && data.includes(permissionName)) return payload;

    return jsonResponse({ success: false, error: 'Forbidden: missing permission' }, 403) as unknown as NextResponse;
  } catch (err) {
    console.warn('requirePermission error', err);
    return jsonResponse({ success: false, error: 'Authorization failure' }, 500) as unknown as NextResponse;
  }
}
