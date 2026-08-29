import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getTenantBranding, updateTenantBranding } from '@/lib/branding.server';
import { BRANDING_DEFAULTS } from '@/lib/branding';

// GET /api/portal/branding — the current tenant's branding. Public (no auth):
// it's all publicly-visible chrome, and the pre-auth login page needs it.
// The tenant is whatever middleware resolved from the host (x-org-id).
export async function GET(request: NextRequest) {
  const orgId = request.headers.get('x-org-id');
  const branding = orgId ? await getTenantBranding(orgId) : BRANDING_DEFAULTS;
  return jsonResponse({ success: true, data: branding });
}

// PUT /api/portal/branding — { companyName?, tagline?, logoUrl?, faviconUrl? }.
// Org admin only. null clears a logo/favicon.
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const { companyName, tagline, logoUrl, faviconUrl } = (body ?? {}) as Record<string, unknown>;

  const patch: Parameters<typeof updateTenantBranding>[1] = {};
  if (companyName !== undefined) {
    if (typeof companyName !== 'string') return jsonResponse({ success: false, error: 'companyName must be a string' }, 400);
    patch.companyName = companyName;
  }
  if (tagline !== undefined) {
    if (typeof tagline !== 'string') return jsonResponse({ success: false, error: 'tagline must be a string' }, 400);
    patch.tagline = tagline;
  }
  if (logoUrl !== undefined) {
    if (logoUrl !== null && typeof logoUrl !== 'string') return jsonResponse({ success: false, error: 'logoUrl must be a string or null' }, 400);
    patch.logoUrl = logoUrl as string | null;
  }
  if (faviconUrl !== undefined) {
    if (faviconUrl !== null && typeof faviconUrl !== 'string') return jsonResponse({ success: false, error: 'faviconUrl must be a string or null' }, 400);
    patch.faviconUrl = faviconUrl as string | null;
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ success: false, error: 'Nothing to update' }, 400);
  }

  try {
    const branding = await updateTenantBranding(auth.organizationId, patch);
    return jsonResponse({ success: true, data: branding });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Update failed' }, 400);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
