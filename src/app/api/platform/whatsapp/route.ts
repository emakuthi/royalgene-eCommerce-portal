import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';
import { getWhatsappSettingsView, setWhatsappSettings } from '@/lib/platform-settings.server';
import { normaliseWhatsappNumber } from '@/lib/daily-report';
import { sendWhatsappTemplate } from '@/lib/whatsapp.server';

// /api/platform/whatsapp — RoyalTrack's WhatsApp sending account. super_admin only.
// The access token is write-only: GET says whether one is saved, never what it is.

export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  return jsonResponse({ success: true, data: await getWhatsappSettingsView() });
}

// PUT { phoneNumberId?, accessToken?, template?, language? } — accessToken "" removes it.
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { phoneNumberId?: string; accessToken?: string; template?: string; language?: string } = {};
  const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : undefined);

  const phoneNumberId = text('phoneNumberId');
  if (phoneNumberId !== undefined) {
    if (phoneNumberId && !/^\d{5,30}$/.test(phoneNumberId)) return bad('Phone number ID is the long number from WhatsApp Manager (digits only)');
    patch.phoneNumberId = phoneNumberId;
  }
  const accessToken = text('accessToken');
  if (accessToken !== undefined) {
    if (accessToken && (accessToken.length < 20 || /\s/.test(accessToken))) return bad('That access token looks incomplete');
    patch.accessToken = accessToken;
  }
  const template = text('template');
  if (template !== undefined) {
    if (template && !/^[a-z0-9_]{1,512}$/.test(template)) return bad('Template names use lowercase letters, numbers and _');
    patch.template = template;
  }
  const language = text('language');
  if (language !== undefined) {
    if (language && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return bad('Language is a code like en or en_US');
    patch.language = language;
  }
  if (Object.keys(patch).length === 0) return bad('Nothing to save');

  try {
    await setWhatsappSettings(patch, auth.userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[platform] saving WhatsApp settings failed', { error: message });
    if (message.includes('CREDENTIALS_ENCRYPTION_KEY')) {
      return jsonResponse({ success: false, error: 'The server has no CREDENTIALS_ENCRYPTION_KEY, so the token can\'t be stored safely. Set it on the server first.', code: 'NOT_CONFIGURED' }, 503);
    }
    return jsonResponse({ success: false, error: 'Could not save (migration 20261111_02 run?)', code: 'INTERNAL_ERROR' }, 500);
  }
  return jsonResponse({ success: true, data: await getWhatsappSettingsView() });
}

// POST { to } — sends the report template with sample numbers to any WhatsApp number.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { to?: unknown };
  const to = typeof body.to === 'string' ? normaliseWhatsappNumber(body.to) : null;
  if (!to) return bad('Enter the WhatsApp number to send the test to');
  const result = await sendWhatsappTemplate(to, [
    'Test Shop', 'today', 'Ksh 18,400', '12', 'M-Pesa Ksh 12,900 · Cash Ksh 5,500', 'Main Ksh 11,200 (7) · Branch Ksh 7,200 (5)', 'all good',
  ]);
  if (!result.ok) return jsonResponse({ success: false, error: `WhatsApp refused it: ${result.error}`, code: 'SEND_FAILED' }, 502);
  return jsonResponse({ success: true, message: 'Sent. Check WhatsApp' });
}

function bad(error: string) {
  return jsonResponse({ success: false, error, code: 'VALIDATION_ERROR' }, 400);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,POST,OPTIONS');
}
