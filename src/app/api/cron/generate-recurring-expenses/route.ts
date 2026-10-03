import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { generateDue } from '@/lib/recurring-expenses.server';
import logger from '@/lib/logger';

/**
 * GET /api/cron/generate-recurring-expenses — Vercel Cron (see vercel.json),
 * daily. Materialises every due recurring-expense template across all tenants.
 * Guarded by CRON_SECRET (Authorization: Bearer $CRON_SECRET); refuses to run
 * if the secret isn't configured, so it can't be triggered anonymously.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  const result = await generateDue();
  logger.info('Cron recurring-expense generation', { ...result });
  return jsonResponse({ success: true, data: result });
}
