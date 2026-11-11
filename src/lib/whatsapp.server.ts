import 'server-only';
import logger from './logger';

/**
 * WhatsApp Cloud API (Meta). A message a business starts must use a template
 * approved in WhatsApp Manager; plain text only works inside a 24h window the
 * customer opened. Off until WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID
 * are set, so nothing is sent from dev or before the account is ready.
 */
const GRAPH_VERSION = 'v21.0';

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsappTemplate(
  to: string,
  template: string,
  bodyParams: string[],
  language = process.env.WHATSAPP_TEMPLATE_LANG || 'en',
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  if (!whatsappConfigured()) return { ok: false, error: 'WhatsApp is not configured' };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) {
      const error = json.error?.message ?? `HTTP ${res.status}`;
      logger.warn('[whatsapp] send failed', { template, status: res.status, error });
      return { ok: false, error };
    }
    return { ok: true, messageId: json.messages?.[0]?.id ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('[whatsapp] send threw', { template, error });
    return { ok: false, error };
  }
}
