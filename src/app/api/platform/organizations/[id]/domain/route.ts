import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { refreshCustomDomainStatus, removeCustomDomain, setCustomDomain } from '@/lib/domains.server';

// Platform-admin custom-domain management for any tenant. Wraps the same
// domains.server helpers the tenant-facing /api/portal/domain route uses; the
// only difference is the org id comes from the URL, not the caller's session.
// super_admin only.

// GET /api/platform/organizations/[id]/domain — current domain + live DNS status.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const state = await refreshCustomDomainStatus(id);
  return jsonResponse({ success: true, data: state });
}

// POST /api/platform/organizations/[id]/domain — { domain } -> attach a custom domain.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { domain } = await request.json();
  if (!domain || typeof domain !== 'string') {
    return jsonResponse({ success: false, error: 'domain is required' }, 400);
  }

  const state = await setCustomDomain(id, domain);
  if (state.error) return jsonResponse({ success: false, error: state.error }, 400);
  return jsonResponse({ success: true, data: state }, 201);
}

// DELETE /api/platform/organizations/[id]/domain — detach the tenant's custom domain.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await removeCustomDomain(id);
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 500);
  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,DELETE,OPTIONS');
}
