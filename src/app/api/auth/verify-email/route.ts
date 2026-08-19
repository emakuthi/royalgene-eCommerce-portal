import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-client';
import { activateOrganization } from '@/lib/organizations.server';
import logger from '@/lib/logger';

// GET /api/auth/verify-email?token=... — consumes an email verification token,
// marks the User as verified, and activates the Organization (moving it out
// of 'pending_verification'). Redirects to a static confirmation page.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const redirect = (ok: boolean) => NextResponse.redirect(new URL(`/verify-email?ok=${ok}`, request.url));

  if (!token) return redirect(false);

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: tokenRow, error } = await supabaseAdmin
    .from('EmailVerificationToken')
    .select('id, userId, organizationId, expiresAt, consumedAt')
    .eq('tokenHash', tokenHash)
    .maybeSingle();

  if (error || !tokenRow) return redirect(false);
  if (tokenRow.consumedAt) return redirect(false);
  if (new Date(tokenRow.expiresAt).getTime() < Date.now()) return redirect(false);

  const now = new Date().toISOString();

  const { error: consumeError } = await supabaseAdmin
    .from('EmailVerificationToken')
    .update({ consumedAt: now })
    .eq('id', tokenRow.id);
  if (consumeError) {
    logger.error('verify-email: failed to mark token consumed', { error: consumeError.message });
    return redirect(false);
  }

  await supabaseAdmin.from('User').update({ emailVerifiedAt: now, updatedAt: now }).eq('id', tokenRow.userId);
  await activateOrganization(tokenRow.organizationId);

  return redirect(true);
}
