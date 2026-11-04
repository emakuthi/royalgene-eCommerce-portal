import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  getSelfSignupEnabled, setSelfSignupEnabled,
  getAllowAllMobileLogins, setAllowAllMobileLogins,
  getMinAppVersionCode, setMinAppVersionCode,
  getMinIosVersionCode, setMinIosVersionCode,
  getPlayLiveVersionCode, setPlayLiveVersionCode,
} from '@/lib/platform-settings.server';

async function readSettings() {
  const [selfSignupEnabled, allowAllMobileLogins, minAppVersionCode, minIosVersionCode, playLiveVersionCode] = await Promise.all([
    getSelfSignupEnabled(),
    getAllowAllMobileLogins(),
    getMinAppVersionCode(),
    getMinIosVersionCode(),
    getPlayLiveVersionCode(),
  ]);
  return { selfSignupEnabled, allowAllMobileLogins, minAppVersionCode, minIosVersionCode, playLiveVersionCode };
}

// GET /api/platform/settings — super_admin only.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  return jsonResponse({ success: true, data: await readSettings() });
}

// PATCH /api/platform/settings — super_admin only.
// Accepts a partial: { selfSignupEnabled?: boolean, allowAllMobileLogins?: boolean, minAppVersionCode?: number, minIosVersionCode?: number }.
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const { selfSignupEnabled, allowAllMobileLogins, minAppVersionCode, minIosVersionCode, playLiveVersionCode, confirmAheadOfPlay } = body as {
    selfSignupEnabled?: unknown; allowAllMobileLogins?: unknown; minAppVersionCode?: unknown; minIosVersionCode?: unknown; playLiveVersionCode?: unknown; confirmAheadOfPlay?: unknown;
  };

  if (selfSignupEnabled === undefined && allowAllMobileLogins === undefined && minAppVersionCode === undefined && minIosVersionCode === undefined && playLiveVersionCode === undefined) {
    return jsonResponse({ success: false, error: 'Provide selfSignupEnabled, allowAllMobileLogins (boolean), minAppVersionCode and/or minIosVersionCode (number)' }, 400);
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

  if (minIosVersionCode !== undefined && !(typeof minIosVersionCode === 'number' && Number.isInteger(minIosVersionCode) && minIosVersionCode >= 0)) {
    return jsonResponse({ success: false, error: 'minIosVersionCode must be a whole number (0 = no minimum)' }, 400);
  }

  if (playLiveVersionCode !== undefined && !(typeof playLiveVersionCode === 'number' && Number.isInteger(playLiveVersionCode) && playLiveVersionCode >= 0)) {
    return jsonResponse({ success: false, error: 'playLiveVersionCode must be a whole number (0 = not recorded)' }, 400);
  }

  // Requiring a build Play doesn't have leaves Play installs on an update
  // screen with nothing to update to, so it takes an explicit confirmation.
  if (typeof minAppVersionCode === 'number' && confirmAheadOfPlay !== true) {
    const playLive = typeof playLiveVersionCode === 'number' ? playLiveVersionCode : await getPlayLiveVersionCode();
    if (playLive > 0 && minAppVersionCode > playLive) {
      return jsonResponse({
        success: false,
        error: `Google Play only has build ${playLive}. Play installs would be blocked with nothing to update to.`,
        code: 'AHEAD_OF_PLAY',
      }, 409);
    }
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

  if (typeof minIosVersionCode === 'number') {
    try {
      await setMinIosVersionCode(minIosVersionCode, auth.userId);
    } catch (e) {
      return jsonResponse({ success: false, error: `Could not save the iOS minimum: ${e instanceof Error ? e.message : String(e)}. Has migration 20261103_01 been run?` }, 500);
    }
  }

  if (typeof playLiveVersionCode === 'number') {
    try {
      await setPlayLiveVersionCode(playLiveVersionCode, auth.userId);
    } catch (e) {
      return jsonResponse({ success: false, error: `Could not save the Google Play build: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
  }

  return jsonResponse({ success: true, data: await readSettings() });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
