import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  getSelfSignupEnabled, setSelfSignupEnabled,
  getAllowAllMobileLogins, setAllowAllMobileLogins,
} from '@/lib/platform-settings.server';

// GET /api/platform/settings — super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const [selfSignupEnabled, allowAllMobileLogins] = await Promise.all([
    getSelfSignupEnabled(),
    getAllowAllMobileLogins(),
  ]);
  return jsonResponse({ success: true, data: { selfSignupEnabled, allowAllMobileLogins } });
}

// PATCH /api/platform/settings — super_admin only.
// Accepts a partial: { selfSignupEnabled?: boolean, allowAllMobileLogins?: boolean }.
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const { selfSignupEnabled, allowAllMobileLogins } = body as {
    selfSignupEnabled?: unknown; allowAllMobileLogins?: unknown;
  };

  if (selfSignupEnabled === undefined && allowAllMobileLogins === undefined) {
    return jsonResponse({ success: false, error: 'Provide selfSignupEnabled and/or allowAllMobileLogins (boolean)' }, 400);
  }
  if (selfSignupEnabled !== undefined && typeof selfSignupEnabled !== 'boolean') {
    return jsonResponse({ success: false, error: 'selfSignupEnabled must be a boolean' }, 400);
  }
  if (allowAllMobileLogins !== undefined && typeof allowAllMobileLogins !== 'boolean') {
    return jsonResponse({ success: false, error: 'allowAllMobileLogins must be a boolean' }, 400);
  }

  if (typeof selfSignupEnabled === 'boolean') await setSelfSignupEnabled(selfSignupEnabled, auth.userId);
  if (typeof allowAllMobileLogins === 'boolean') await setAllowAllMobileLogins(allowAllMobileLogins, auth.userId);

  const [selfSignup, mobileAll] = await Promise.all([getSelfSignupEnabled(), getAllowAllMobileLogins()]);
  return jsonResponse({ success: true, data: { selfSignupEnabled: selfSignup, allowAllMobileLogins: mobileAll } });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
