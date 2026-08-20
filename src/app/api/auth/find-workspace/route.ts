import { NextRequest } from 'next/server';
import { randomInt, createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { sendWorkspaceCodeEmail } from '@/lib/email/workspace-code-email';
import logger from '@/lib/logger';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/auth/find-workspace — { email } -> sends a one-time code to that
 * email if it belongs to any organization, then GET the actual workspace(s)
 * from POST /api/auth/verify-workspace-code once the user proves they
 * control the inbox. Always responds the same way regardless of whether the
 * email matched anything (`{sent: true}`) — the response itself can't be
 * used to enumerate which emails have an account; only actually receiving
 * the email would confirm that, which requires controlling the inbox.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return jsonResponse({ success: false, error: 'Email is required' }, 400);
    }
    const normalizedEmail = email.trim().toLowerCase();

    const { data: users, error } = await supabaseAdmin
      .from('User')
      .select('organizationId')
      .eq('email', normalizedEmail)
      .not('organizationId', 'is', null);

    if (error) {
      logger.error('[find-workspace] user lookup failed', { error: error.message });
      return jsonResponse({ success: false, error: 'Lookup failed' }, 500);
    }

    const hasOrg = (users ?? []).length > 0;
    if (hasOrg) {
      const code = randomInt(100000, 1000000).toString();
      const codeHash = createHash('sha256').update(code).digest('hex');
      const now = new Date();

      const { error: insertError } = await supabaseAdmin.from('WorkspaceLookupCode').insert([{
        email: normalizedEmail,
        codeHash,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
        createdAt: now.toISOString(),
      }]);

      if (insertError) {
        logger.error('[find-workspace] failed to store code', { error: insertError.message });
      } else {
        const sendResult = await sendWorkspaceCodeEmail({ to: normalizedEmail, code });
        if (!sendResult.ok) {
          logger.warn('[find-workspace] failed to send code email', { error: sendResult.error });
        }
      }
    }

    return jsonResponse({ success: true, data: { sent: true } });
  } catch (err) {
    logger.error('[find-workspace] error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
