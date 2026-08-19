import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listOrganizations } from '@/lib/organizations.server';

// GET /api/platform/organizations — every tenant + user/shop counts, super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const organizations = await listOrganizations();
  return jsonResponse({ success: true, data: organizations });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
