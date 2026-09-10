import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { resetPasswordWithCode } from '@/lib/password-reset.server';
import logger from '@/lib/logger';

/**
 * POST /api/auth/reset-password — { email, code, password }
 * Verifies the emailed code and sets the new password.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code, password } = await request.json().catch(() => ({}));
    if (typeof email !== 'string' || typeof code !== 'string' || typeof password !== 'string') {
      return jsonResponse({ success: false, error: 'email, code and password are required' }, 400);
    }

    const result = await resetPasswordWithCode(email, code, password);
    if (!result.ok) {
      return jsonResponse({ success: false, error: result.error, code: result.code }, result.status);
    }
    return jsonResponse({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    logger.error('[reset-password] error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
