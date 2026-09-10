import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { requestPasswordReset } from '@/lib/password-reset.server';
import logger from '@/lib/logger';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * POST /api/mobile/auth/forgot-password — { email }
 * Emails a one-time reset code. Always responds `{ success: true }`.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return jsonResponse({ success: false, error: 'Email is required', code: 'VALIDATION_ERROR' }, 400);
    }
    await requestPasswordReset(email);
  } catch (err) {
    logger.error('[mobile forgot-password] error', { error: err instanceof Error ? err.message : String(err) });
  }
  return jsonResponse({ success: true, data: { sent: true } }, 200);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
