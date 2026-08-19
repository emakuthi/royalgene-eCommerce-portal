import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { VerifiedPayload } from './auth.server';
import { jsonResponse } from './apiResponse';

/**
 * Cross-checks the tenant claimed by a verified JWT (payload.organizationId)
 * against the tenant resolved from the request's Host header by middleware.ts
 * (propagated as the x-org-id request header). Mismatch always rejects (403) —
 * this is the primitive that prevents a valid token issued for one tenant's
 * subdomain from being replayed against another tenant's subdomain.
 *
 * super_admin is a platform-level role (organizationId is null) and is exempt —
 * platform staff operate across tenants by design.
 *
 * Returns null when the check passes (caller should proceed), or a NextResponse
 * to return immediately when it fails.
 */
export function assertTenantMatch(request: NextRequest, payload: VerifiedPayload): NextResponse | null {
  if (payload.role === 'super_admin') return null;

  const hostOrgId = request.headers.get('x-org-id');
  const claimedOrgId = typeof payload.organizationId === 'string' ? payload.organizationId : null;

  if (!hostOrgId) {
    return jsonResponse({ success: false, error: 'Tenant context missing' }, 400) as unknown as NextResponse;
  }

  if (!claimedOrgId || claimedOrgId !== hostOrgId) {
    return jsonResponse({ success: false, error: 'Forbidden: cross-tenant request' }, 403) as unknown as NextResponse;
  }

  return null;
}
