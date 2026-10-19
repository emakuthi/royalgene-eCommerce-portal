import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { isPaystackConfigured } from '@/lib/paystack.server';
import { reconcilePaystackRenewals } from '@/lib/billing/paystack-renewals.server';
import { sendRenewalReminders } from '@/lib/billing/renewal-reminders.server';
import logger from '@/lib/logger';

/**
 * GET /api/cron/paystack-renewals — invoked by Vercel Cron (see vercel.json)
 * once a day. Records any Paystack renewal charge the webhook missed, so a
 * paid workspace never turns read-only by mistake, then emails workspaces
 * paying by M-Pesa whose plan runs out soon. Guarded by CRON_SECRET, like the
 * other crons.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!isPaystackConfigured()) {
    return jsonResponse({ success: true, data: { skipped: 'Paystack not configured' } });
  }

  try {
    // Renewals first, so a workspace that already paid isn't reminded to.
    const result = await reconcilePaystackRenewals();
    const reminders = await sendRenewalReminders();
    logger.info('Cron Paystack renewal check', { ...result, remindersDue: reminders.due, remindersSent: reminders.sent });
    return jsonResponse({ success: result.failed === 0, data: { ...result, reminders } });
  } catch (err) {
    logger.error('Cron Paystack renewal check failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Renewal check failed' }, 500);
  }
}
