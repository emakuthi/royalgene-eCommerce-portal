import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listOrganizations } from '@/lib/organizations.server';

// GET /api/platform/organizations — every tenant + user/shop counts, super_admin only.
// ?includeDeleted=true also returns soft-deleted tenants.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const includeDeleted = request.nextUrl.searchParams.get('includeDeleted') === 'true';
  const organizations = await listOrganizations({ includeDeleted });
  return jsonResponse({ success: true, data: organizations });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
