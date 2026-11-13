import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { syncExchangeRates } from '@/lib/exchange-rates.server';
import logger from '@/lib/logger';

/**
 * GET /api/cron/sync-exchange-rates — invoked by Vercel Cron (see vercel.json)
 * once a day. Guarded by CRON_SECRET: Vercel sends `Authorization: Bearer
 * $CRON_SECRET`. If CRON_SECRET isn't configured the endpoint refuses to run
 * (so it can't be triggered anonymously).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  const result = await syncExchangeRates();
  logger.info('Cron exchange-rate sync', { ...result });
  // Return 200 even on a rate-service outage — Vercel shouldn't retry-storm a
  // temporary upstream failure; the result flags ok:false for observability.
  return jsonResponse({ success: result.ok, data: result });
}
