import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { sendDueDailyReports } from '@/lib/daily-report.server';
import logger from '@/lib/logger';

/**
 * GET /api/cron/daily-whatsapp-report — each owner's end-of-day summary on
 * WhatsApp. Schedule it once in the evening (e.g. 21:00 Kenya time = 18:00
 * UTC). Guarded by CRON_SECRET (Authorization: Bearer $CRON_SECRET); refuses
 * to run if the secret isn't configured, so it can't be triggered anonymously.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  const result = await sendDueDailyReports();
  logger.info('Cron daily WhatsApp report', { ...result });
  return jsonResponse({ success: true, data: result });
}
