/**
 * GET /api/mobile/devices
 * List the caller's own signed-in devices, most recently active first —
 * self-service only (a user manages their own devices, not an admin
 * managing everyone's — see device-registry.server.ts's doc for why this
 * doesn't reuse the org-wide sync model the other mobile entities use).
 */
import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { listDevices } from '@/lib/device-registry.server';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;

    const devices = await listDevices(auth.payload.userId);

    return jsonResponse({ success: true, data: { devices } }, 200);
  } catch (error) {
    logger.error('Mobile devices GET error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
