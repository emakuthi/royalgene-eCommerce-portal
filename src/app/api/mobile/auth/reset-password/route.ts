import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { resetPasswordWithCode } from '@/lib/password-reset.server';
import logger from '@/lib/logger';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * POST /api/mobile/auth/reset-password — { email, code, password }
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code, password } = await request.json().catch(() => ({}));
    if (typeof email !== 'string' || typeof code !== 'string' || typeof password !== 'string') {
      return jsonResponse({ success: false, error: 'email, code and password are required', code: 'VALIDATION_ERROR' }, 400);
    }
    const result = await resetPasswordWithCode(email, code, password);
    if (!result.ok) {
      return jsonResponse({ success: false, error: result.error, code: result.code }, result.status);
    }
    return jsonResponse({ success: true, message: 'Password updated. You can sign in now.' }, 200);
  } catch (err) {
    logger.error('[mobile reset-password] error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
