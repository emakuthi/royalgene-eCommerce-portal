import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getPlatformCapacity } from '@/lib/platform-capacity.server';

// GET /api/platform/capacity — cross-tenant aggregate usage, super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const capacity = await getPlatformCapacity();
  return jsonResponse({ success: true, data: capacity });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
