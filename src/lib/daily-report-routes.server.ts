import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { jsonResponse } from './apiResponse';
import logger from './logger';
import { normaliseWhatsappNumber } from './daily-report';
import { buildDailyReportParams } from './daily-report.server';
import { sendWhatsappTemplate, whatsappConfigured } from './whatsapp.server';

// Shared bodies of the portal and mobile daily-report routes. Owner only: the
// callers check the role, because the number is the owner's own phone.

/** { whatsapp: "254712345678" | "", available: WhatsApp sending is set up on the server } */
export async function dailyReportGet(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('dailyReportWhatsapp')
    .eq('id', organizationId)
    .maybeSingle();
  const whatsapp = error ? '' : ((data as { dailyReportWhatsapp?: string | null } | null)?.dailyReportWhatsapp ?? '');
  return jsonResponse({ success: true, data: { whatsapp, available: whatsappConfigured() } });
}

/** Body: { whatsapp: string } — "" turns the report off. */
export async function dailyReportPut(organizationId: string, request: Request) {
  const body = (await request.json().catch(() => null)) as { whatsapp?: unknown } | null;
  if (!body || typeof body.whatsapp !== 'string') {
    return jsonResponse({ success: false, error: 'whatsapp must be a phone number or ""', code: 'VALIDATION_ERROR' }, 400);
  }
  let whatsapp: string | null = null;
  if (body.whatsapp.trim()) {
    whatsapp = normaliseWhatsappNumber(body.whatsapp);
    if (!whatsapp) {
      return jsonResponse({ success: false, error: 'Enter a phone number like 0712 345 678 or +254 712 345 678', code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ dailyReportWhatsapp: whatsapp, updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
  if (error) {
    logger.error('[daily-report] saving the number failed (migration 20261111_01 run?)', { organizationId, error: error.message });
    return jsonResponse({ success: false, error: 'The daily report is not available yet', code: 'INTERNAL_ERROR' }, 500);
  }
  return jsonResponse({ success: true, data: { whatsapp: whatsapp ?? '', available: whatsappConfigured() } });
}

/** Sends today's report now, without marking the day as sent. */
export async function dailyReportTest(organizationId: string) {
  if (!whatsappConfigured()) {
    return jsonResponse({ success: false, error: 'WhatsApp sending is not set up on the server yet', code: 'NOT_CONFIGURED' }, 503);
  }
  const { data } = await supabaseAdmin.from('Organization').select('dailyReportWhatsapp').eq('id', organizationId).maybeSingle();
  const to = (data as { dailyReportWhatsapp?: string | null } | null)?.dailyReportWhatsapp;
  if (!to) return jsonResponse({ success: false, error: 'Save a WhatsApp number first', code: 'VALIDATION_ERROR' }, 400);
  try {
    const params = await buildDailyReportParams(organizationId);
    const result = await sendWhatsappTemplate(to, process.env.WHATSAPP_DAILY_REPORT_TEMPLATE || 'daily_sales_report', params);
    if (!result.ok) return jsonResponse({ success: false, error: `WhatsApp refused it: ${result.error}`, code: 'SEND_FAILED' }, 502);
    return jsonResponse({ success: true, message: 'Sent — check WhatsApp' });
  } catch (err) {
    logger.error('[daily-report] test send failed', { organizationId, error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Could not build the report', code: 'INTERNAL_ERROR' }, 500);
  }
}
