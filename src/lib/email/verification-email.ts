import 'server-only';
import { getOrgUrl } from '../urls';
import { sendEmail } from './smtp-client';

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  orgName: string;
  orgSlug: string;
  token: string;
}): Promise<{ ok: boolean; error?: string }> {
  const verifyUrl = getOrgUrl(opts.orgSlug, `/verify-email?token=${encodeURIComponent(opts.token)}`);

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Welcome to ${escapeHtml(opts.orgName)} on Royal Gene</h2>
      <p>Hi ${escapeHtml(opts.name)},</p>
      <p>Confirm your email address to finish setting up your workspace.</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Verify email</a></p>
      <p>Or paste this link into your browser:<br />${verifyUrl}</p>
      <p>This link expires in 24 hours.</p>
    </div>
  `.trim();

  const text = `Welcome to ${opts.orgName} on Royal Gene.\n\nConfirm your email: ${verifyUrl}\n\nThis link expires in 24 hours.`;

  const result = await sendEmail({
    to: opts.to,
    subject: `Verify your email for ${opts.orgName}`,
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
