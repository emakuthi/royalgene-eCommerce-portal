import 'server-only';
import { sendEmail } from './smtp-client';

/** Sent by POST /api/auth/find-workspace — a one-time code to prove the requester controls this email before their workspace membership is disclosed. */
export async function sendWorkspaceCodeEmail(opts: { to: string; code: string }): Promise<{ ok: boolean; error?: string }> {
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Find your workspace</h2>
      <p>Enter this code in the app to see which workspace this email belongs to:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 16px; background: #f4f4f5; border-radius: 8px;">${opts.code}</p>
      <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `.trim();

  const text = `Your workspace verification code is: ${opts.code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`;

  const result = await sendEmail({
    to: opts.to,
    subject: 'Your workspace verification code',
    html,
    text,
  });

  return { ok: result.ok, error: result.error };
}
