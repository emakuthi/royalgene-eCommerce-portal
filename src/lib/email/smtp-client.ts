import 'server-only';
import nodemailer from 'nodemailer';
import logger from '../logger';

// Thin wrapper around the transactional email provider (Hostinger SMTP). All
// provider-specific code is isolated here so a future provider swap touches
// only this file.

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || SMTP_USER;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    // No provider configured (e.g. local dev) — log instead of failing the
    // calling flow outright, so signup/verification is still exercisable.
    logger.warn('[email] SMTP not configured — logging email instead of sending', {
      to: input.to,
      subject: input.subject,
    });
    console.info(`[email:dev] to=${input.to} subject="${input.subject}"\n${input.text ?? input.html}`);
    return { ok: true, id: 'dev-noop' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    logger.error('[email] SMTP send failed', { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
