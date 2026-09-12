/**
 * POST /api/mobile/devices/[deviceId]/revoke
 * Sign a device out remotely — self-service only (see GET /devices' doc).
 * The revoked device's next authenticated request (checked in
 * verifyMobileShopAccess/verifyMobileAuth) gets a 401 DEVICE_REVOKED and
 * must sign in again; a fresh sign-in from that device un-revokes it (see
 * registerDevice's doc — logging back in is itself proof of legitimate
 * access).
 */
import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { revokeDevice } from '@/lib/device-registry.server';
import logger from '@/lib/logger';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;

    const { deviceId } = await context.params;
    const revoked = await revokeDevice(auth.payload.userId, deviceId);

    if (!revoked) {
      return jsonResponse({ success: false, error: 'Device not found (or already signed out)', code: 'NOT_FOUND' }, 404);
    }

    logger.info('Mobile device revoked', { userId: auth.payload.userId, deviceId });
    return jsonResponse({ success: true, message: 'Device signed out' }, 200);
  } catch (error) {
    logger.error('Mobile device revoke error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
