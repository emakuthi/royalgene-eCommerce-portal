import { NextRequest } from 'next/server';
import { extractTokenFromHeader, signAuthToken, verifyToken, type AuthTokenPayload } from '@/lib/auth.server';
import { isDeviceRevoked } from '@/lib/device-registry.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

/**
 * POST /api/mobile/auth/refresh — swaps the app's current token (valid, or
 * expired within MOBILE_TOKEN_GRACE_SECONDS) for a fresh one with the same
 * claims, so a signed-in phone never just stops syncing when its token
 * runs out. Refuses a revoked device or a user that no longer exists.
 */
export async function POST(request: NextRequest) {
  const payload = verifyToken(extractTokenFromHeader(request.headers.get('authorization')));
  if (!payload) {
    return jsonResponse({ success: false, error: 'Session expired — please sign in again', code: 'SESSION_EXPIRED' }, 401);
  }

  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId : null;
  if (deviceId && (await isDeviceRevoked(payload.userId, deviceId))) {
    return jsonResponse({ success: false, error: 'This device has been signed out', code: 'DEVICE_REVOKED' }, 401);
  }

  const { data: user } = await supabaseAdmin
    .from('User')
    .select('id, email, role, organizationId')
    .eq('id', payload.userId)
    .maybeSingle();
  if (!user) {
    return jsonResponse({ success: false, error: 'Session expired — please sign in again', code: 'SESSION_EXPIRED' }, 401);
  }

  // Role/org come from the database, not the old token — a change since
  // sign-in (e.g. role edited) takes effect on refresh.
  const token = signAuthToken({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    email: user.email,
    role: user.role as AuthTokenPayload['role'],
    shopId: typeof payload.shopId === 'string' ? payload.shopId : null,
    deviceId,
  });

  logger.info('Mobile token refreshed', { userId: user.id, wasExpired: Boolean(payload.expiredWithinGrace) });
  return jsonResponse({ success: true, data: { token } });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
