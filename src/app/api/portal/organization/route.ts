import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getOrganizationById } from '@/lib/organizations.server';

// GET /api/portal/organization — the caller's own organization (billing/plan status, etc).
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 404);
  }

  const organization = await getOrganizationById(auth.organizationId);
  if (!organization) return jsonResponse({ success: false, error: 'Organization not found' }, 404);

  return jsonResponse({ success: true, data: organization });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
