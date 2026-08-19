import 'server-only';
import logger from '../logger';

// Thin wrapper around the transactional email provider. All Resend-specific
// code is isolated here so a future provider swap touches only this file.

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'no-reply@royalgene.app';

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    // No provider configured (e.g. local dev) — log instead of failing the
    // calling flow outright, so signup/verification is still exercisable.
    logger.warn('[email] RESEND_API_KEY not set — logging email instead of sending', {
      to: input.to,
      subject: input.subject,
    });
    console.info(`[email:dev] to=${input.to} subject="${input.subject}"\n${input.text ?? input.html}`);
    return { ok: true, id: 'dev-noop' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('[email] Resend send failed', { status: res.status, body });
      return { ok: false, error: `Resend responded ${res.status}` };
    }

    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (err) {
    logger.error('[email] Resend send threw', { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
