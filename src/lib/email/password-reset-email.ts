import 'server-only';
import { sendEmail } from './smtp-client';

/**
 * Sent by POST /api/auth/forgot-password (and the mobile equivalent) — a
 * one-time 6-digit code the account holder enters to set a new password.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  name?: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : 'Hi,';

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Reset your RoyalTrack password</h2>
      <p>${greeting}</p>
      <p>Enter this code to set a new password:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f5; border-radius: 8px;">${opts.code}</p>
      <p>This code expires in 30 minutes. If you didn't ask to reset your password, you can ignore this email — your password won't change.</p>
    </div>
  `.trim();

  const text = `Reset your RoyalTrack password.\n\nYour code is: ${opts.code}\n\nThis code expires in 30 minutes. If you didn't request this, ignore this email.`;

  const result = await sendEmail({
    to: opts.to,
    subject: 'Your RoyalTrack password reset code',
    html,
    text,
  });

  return { ok: result.ok, error: result.error };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
