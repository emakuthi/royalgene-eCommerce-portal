import 'server-only';
import logger from './logger';
import { getWhatsappConfig } from './platform-settings.server';

/**
 * WhatsApp Cloud API (Meta). A message a business starts must use a template
 * approved in WhatsApp Manager; plain text only works inside a 24h window the
 * customer opened. The sending account is set in the platform console
 * (falling back to WHATSAPP_* env vars); with neither, nothing is sent.
 */
const GRAPH_VERSION = 'v21.0';

export async function whatsappConfigured(): Promise<boolean> {
  return (await getWhatsappConfig()) !== null;
}

/** Sends the account's report template (or [template]) with these body parameters. */
export async function sendWhatsappTemplate(
  to: string,
  bodyParams: string[],
  template?: string,
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const config = await getWhatsappConfig();
  if (!config) return { ok: false, error: 'WhatsApp is not configured' };
  const name = template || config.template;
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          language: { code: config.language },
          components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) {
      const error = json.error?.message ?? `HTTP ${res.status}`;
      logger.warn('[whatsapp] send failed', { template: name, status: res.status, error });
      return { ok: false, error };
    }
    return { ok: true, messageId: json.messages?.[0]?.id ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('[whatsapp] send threw', { template: name, error });
    return { ok: false, error };
  }
}
