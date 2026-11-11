import 'server-only';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';
import { businessDateKey, startOfBusinessDay, BUSINESS_TIME_ZONE } from './business-time';
import { summariseDay, reportTemplateParams, type ReportSale, type ReportStock } from './daily-report';
import { sendWhatsappTemplate, whatsappConfigured } from './whatsapp.server';

const TEMPLATE = () => process.env.WHATSAPP_DAILY_REPORT_TEMPLATE || 'daily_sales_report';

/** Builds one business's report for the business day containing `now`, as template parameters. */
export async function buildDailyReportParams(organizationId: string, now = new Date()): Promise<string[]> {
  const from = startOfBusinessDay(now).toISOString();
  const to = startOfBusinessDay(now, 1).toISOString();
  const [org, sales, shops, stock] = await Promise.all([
    supabaseAdmin.from('Organization').select('name, currency').eq('id', organizationId).maybeSingle(),
    supabaseAdmin
      .from('SalesEntry')
      .select('id, shopId, saleGroupId, totalAmount, paymentMethod, paymentBreakdown, deletedAt')
      .eq('organizationId', organizationId)
      .gte('entryDate', from)
      .lt('entryDate', to),
    supabaseAdmin.from('Shop').select('id, name').eq('organizationId', organizationId),
    supabaseAdmin
      .from('ShopStock')
      .select('quantity, lowStockThreshold')
      .eq('organizationId', organizationId)
      .is('deletedAt', null),
  ]);
  for (const r of [org, sales, shops, stock]) if (r.error) throw new Error(r.error.message);

  const shopNames = Object.fromEntries(((shops.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  const report = summariseDay((sales.data ?? []) as ReportSale[], shopNames, (stock.data ?? []) as ReportStock[]);
  const o = (org.data ?? {}) as { name?: string; currency?: string | null };
  const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(now);
  return reportTemplateParams(report, o.name || 'your business', dateLabel, o.currency || 'KES');
}

/**
 * Sends today's report to every business that set a WhatsApp number and
 * hasn't had today's yet. Run once in the evening; safe to run again (the
 * day is recorded per business, so a retry only sends the ones that failed).
 */
export async function sendDueDailyReports(now = new Date()): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!whatsappConfigured()) return { sent: 0, failed: 0, skipped: 0 };
  const today = businessDateKey(now);
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('id, dailyReportWhatsapp, dailyReportLastSentOn')
    .not('dailyReportWhatsapp', 'is', null);
  if (error) {
    logger.error('[daily-report] listing businesses failed (migration 20261111_01 run?)', { error: error.message });
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const org of (data ?? []) as Array<{ id: string; dailyReportWhatsapp: string; dailyReportLastSentOn: string | null }>) {
    if (org.dailyReportLastSentOn === today) { skipped++; continue; }
    try {
      const params = await buildDailyReportParams(org.id, now);
      const result = await sendWhatsappTemplate(org.dailyReportWhatsapp, TEMPLATE(), params);
      if (!result.ok) { failed++; continue; }
      await supabaseAdmin.from('Organization').update({ dailyReportLastSentOn: today }).eq('id', org.id);
      sent++;
    } catch (err) {
      failed++;
      logger.error('[daily-report] build failed', { organizationId: org.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed, skipped };
}
