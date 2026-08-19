import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getSelfSignupEnabled, setSelfSignupEnabled } from '@/lib/platform-settings.server';

// GET /api/platform/settings — super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const selfSignupEnabled = await getSelfSignupEnabled();
  return jsonResponse({ success: true, data: { selfSignupEnabled } });
}

// PATCH /api/platform/settings — { selfSignupEnabled: boolean }, super_admin only.
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { selfSignupEnabled } = await request.json();
  if (typeof selfSignupEnabled !== 'boolean') {
    return jsonResponse({ success: false, error: 'selfSignupEnabled must be a boolean' }, 400);
  }

  await setSelfSignupEnabled(selfSignupEnabled, auth.userId);
  return jsonResponse({ success: true, data: { selfSignupEnabled } });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
