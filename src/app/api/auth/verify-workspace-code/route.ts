import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

const MAX_ATTEMPTS = 5;

/**
 * POST /api/auth/verify-workspace-code — { email, code } -> the workspace(s)
 * that email belongs to, only once the code sent by POST /api/auth/find-workspace
 * is confirmed. One-time use (consumedAt), expires 10 minutes after issue,
 * and locks out further attempts on that code after MAX_ATTEMPTS wrong guesses
 * to make brute-forcing a 6-digit code impractical.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();
    if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
      return jsonResponse({ success: false, error: 'Email and code are required' }, 400);
    }
    const normalizedEmail = email.trim().toLowerCase();

    const { data: codeRow, error } = await supabaseAdmin
      .from('WorkspaceLookupCode')
      .select('*')
      .eq('email', normalizedEmail)
      .is('consumedAt', null)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('[verify-workspace-code] lookup failed', { error: error.message });
      return jsonResponse({ success: false, error: 'Verification failed' }, 500);
    }

    if (!codeRow || new Date(codeRow.expiresAt).getTime() < Date.now()) {
      return jsonResponse({ success: false, error: 'That code has expired. Request a new one.', code: 'CODE_EXPIRED' }, 400);
    }

    if (codeRow.attempts >= MAX_ATTEMPTS) {
      return jsonResponse({ success: false, error: 'Too many incorrect attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' }, 429);
    }

    const submittedHash = createHash('sha256').update(code.trim()).digest('hex');
    if (submittedHash !== codeRow.codeHash) {
      await supabaseAdmin.from('WorkspaceLookupCode').update({ attempts: codeRow.attempts + 1 }).eq('id', codeRow.id);
      return jsonResponse({ success: false, error: 'Incorrect code', code: 'INVALID_CODE' }, 400);
    }

    await supabaseAdmin.from('WorkspaceLookupCode').update({ consumedAt: new Date().toISOString() }).eq('id', codeRow.id);

    const { data: users } = await supabaseAdmin
      .from('User')
      .select('organizationId')
      .eq('email', normalizedEmail)
      .not('organizationId', 'is', null);

    const orgIds = Array.from(new Set((users ?? []).map((u) => u.organizationId as string).filter(Boolean)));
    if (orgIds.length === 0) {
      return jsonResponse({ success: true, data: { organizations: [] } });
    }

    const { data: orgs } = await supabaseAdmin
      .from('Organization')
      .select('name, slug')
      .in('id', orgIds)
      .eq('status', 'active');

    return jsonResponse({ success: true, data: { organizations: orgs ?? [] } });
  } catch (err) {
    logger.error('[verify-workspace-code] error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
