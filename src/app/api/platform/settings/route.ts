import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  getSelfSignupEnabled, setSelfSignupEnabled,
  getAllowAllMobileLogins, setAllowAllMobileLogins,
  getMinAppVersionCode, setMinAppVersionCode,
} from '@/lib/platform-settings.server';

async function readSettings() {
  const [selfSignupEnabled, allowAllMobileLogins, minAppVersionCode] = await Promise.all([
    getSelfSignupEnabled(),
    getAllowAllMobileLogins(),
    getMinAppVersionCode(),
  ]);
  return { selfSignupEnabled, allowAllMobileLogins, minAppVersionCode };
}

// GET /api/platform/settings — super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  return jsonResponse({ success: true, data: await readSettings() });
}

// PATCH /api/platform/settings — super_admin only.
// Accepts a partial: { selfSignupEnabled?: boolean, allowAllMobileLogins?: boolean, minAppVersionCode?: number }.
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const { selfSignupEnabled, allowAllMobileLogins, minAppVersionCode } = body as {
    selfSignupEnabled?: unknown; allowAllMobileLogins?: unknown; minAppVersionCode?: unknown;
  };

  if (selfSignupEnabled === undefined && allowAllMobileLogins === undefined && minAppVersionCode === undefined) {
    return jsonResponse({ success: false, error: 'Provide selfSignupEnabled, allowAllMobileLogins (boolean) and/or minAppVersionCode (number)' }, 400);
  }
  if (selfSignupEnabled !== undefined && typeof selfSignupEnabled !== 'boolean') {
    return jsonResponse({ success: false, error: 'selfSignupEnabled must be a boolean' }, 400);
  }
  if (allowAllMobileLogins !== undefined && typeof allowAllMobileLogins !== 'boolean') {
    return jsonResponse({ success: false, error: 'allowAllMobileLogins must be a boolean' }, 400);
  }
  if (minAppVersionCode !== undefined && !(typeof minAppVersionCode === 'number' && Number.isInteger(minAppVersionCode) && minAppVersionCode >= 0)) {
    return jsonResponse({ success: false, error: 'minAppVersionCode must be a whole number (0 = no minimum)' }, 400);
  }

  if (typeof selfSignupEnabled === 'boolean') await setSelfSignupEnabled(selfSignupEnabled, auth.userId);
  if (typeof allowAllMobileLogins === 'boolean') await setAllowAllMobileLogins(allowAllMobileLogins, auth.userId);
  if (typeof minAppVersionCode === 'number') {
    try {
      await setMinAppVersionCode(minAppVersionCode, auth.userId);
    } catch (e) {
      return jsonResponse({ success: false, error: `Could not save the minimum version: ${e instanceof Error ? e.message : String(e)}. Has migration 20261013_01 been run?` }, 500);
    }
  }

  return jsonResponse({ success: true, data: await readSettings() });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
