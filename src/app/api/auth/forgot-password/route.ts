import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { requestPasswordReset } from '@/lib/password-reset.server';
import logger from '@/lib/logger';

/**
 * POST /api/auth/forgot-password — { email }
 *
 * Emails a one-time code if the address has an account. Always responds
 * `{ success: true }` so the response can't be used to check which emails
 * are registered.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return jsonResponse({ success: false, error: 'Email is required' }, 400);
    }
    await requestPasswordReset(email);
    return jsonResponse({ success: true, data: { sent: true } });
  } catch (err) {
    logger.error('[forgot-password] error', { error: err instanceof Error ? err.message : String(err) });
    // Still generic — don't leak failure states either.
    return jsonResponse({ success: true, data: { sent: true } });
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
