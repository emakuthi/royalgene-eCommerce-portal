import 'server-only';
import { randomInt, createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase-client';
import { hashPassword } from './auth.server';
import { sendPasswordResetEmail } from './email/password-reset-email';
import logger from './logger';

const CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ATTEMPTS = 5;
const RESEND_THROTTLE_MS = 60 * 1000; // one code per minute per account
const MIN_PASSWORD_LEN = 8;

const hashCode = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

/**
 * Step 1 — email a one-time reset code to the account holder.
 *
 * Always resolves the same way regardless of whether the email has an
 * account: only actually receiving the email confirms it, which requires
 * controlling the inbox. Callers must NOT branch on the result.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return;

  const { data: user } = await supabaseAdmin
    .from('User')
    .select('id, name')
    .eq('email', email)
    .maybeSingle();

  if (!user) {
    logger.info('[password-reset] request for unknown email', { email });
    return;
  }

  // Throttle: skip if a code went out in the last minute.
  const { data: recent } = await supabaseAdmin
    .from('PasswordResetCode')
    .select('createdAt')
    .eq('userId', user.id)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < RESEND_THROTTLE_MS) {
    logger.info('[password-reset] throttled', { userId: user.id });
    return;
  }

  const code = randomInt(100000, 1000000).toString();
  const now = new Date();

  const { error: insertError } = await supabaseAdmin.from('PasswordResetCode').insert([{
    userId: user.id,
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  }]);
  if (insertError) {
    logger.error('[password-reset] failed to store code', { error: insertError.message });
    return;
  }

  const sent = await sendPasswordResetEmail({ to: email, name: user.name ?? undefined, code });
  if (!sent.ok) logger.warn('[password-reset] failed to send email', { error: sent.error, userId: user.id });
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Step 2 — verify the code and set the new password.
 */
export async function resetPasswordWithCode(
  rawEmail: string,
  rawCode: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const email = rawEmail.trim().toLowerCase();
  const code = String(rawCode ?? '').trim();

  if (!email || !code) return { ok: false, status: 400, error: 'Email and code are required' };
  if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
    return { ok: false, status: 400, error: `Password must be at least ${MIN_PASSWORD_LEN} characters` };
  }

  const { data: user } = await supabaseAdmin
    .from('User').select('id').eq('email', email).maybeSingle();
  // Same generic error whether the account or the code is wrong.
  const badCode: ResetPasswordResult = { ok: false, status: 400, error: 'That code is invalid or has expired', code: 'INVALID_CODE' };
  if (!user) return badCode;

  const { data: row } = await supabaseAdmin
    .from('PasswordResetCode')
    .select('*')
    .eq('userId', user.id)
    .is('consumedAt', null)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return badCode;
  if (new Date(row.expiresAt).getTime() < Date.now()) return badCode;
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, status: 429, error: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' };
  }

  if (hashCode(code) !== row.codeHash) {
    await supabaseAdmin.from('PasswordResetCode').update({ attempts: row.attempts + 1 }).eq('id', row.id);
    return badCode;
  }

  const now = new Date().toISOString();
  const hashed = await hashPassword(newPassword);

  const { error: updateError } = await supabaseAdmin
    .from('User')
    .update({ password: hashed, passwordChangedAt: now, updatedAt: now })
    .eq('id', user.id);
  if (updateError) {
    logger.error('[password-reset] failed to update password', { error: updateError.message, userId: user.id });
    return { ok: false, status: 500, error: 'Could not update the password. Try again.' };
  }

  // Consume this code and invalidate any other outstanding ones for the user.
  await supabaseAdmin
    .from('PasswordResetCode')
    .update({ consumedAt: now })
    .eq('userId', user.id)
    .is('consumedAt', null);

  logger.info('[password-reset] password reset', { userId: user.id });
  return { ok: true };
}
