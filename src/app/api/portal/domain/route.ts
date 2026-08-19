import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { refreshCustomDomainStatus, removeCustomDomain, setCustomDomain } from '@/lib/domains.server';

// GET /api/portal/domain — current domain + live status check. Org admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);

  const state = await refreshCustomDomainStatus(auth.organizationId);
  return jsonResponse({ success: true, data: state });
}

// POST /api/portal/domain — { domain } -> attach a custom domain. Org admin only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);

  const { domain } = await request.json();
  if (!domain || typeof domain !== 'string') {
    return jsonResponse({ success: false, error: 'domain is required' }, 400);
  }

  const state = await setCustomDomain(auth.organizationId, domain);
  if (state.error) return jsonResponse({ success: false, error: state.error }, 400);
  return jsonResponse({ success: true, data: state }, 201);
}

// DELETE /api/portal/domain — removes the org's custom domain. Org admin only.
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);

  const result = await removeCustomDomain(auth.organizationId);
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 500);
  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,DELETE,OPTIONS');
}
