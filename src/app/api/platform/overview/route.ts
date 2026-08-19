import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getPlatformOverview } from '@/lib/organizations.server';

// GET /api/platform/overview — platform-wide stats, super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const overview = await getPlatformOverview();
  return jsonResponse({ success: true, data: overview });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
