import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { isPaystackConfigured } from '@/lib/paystack.server';
import { reconcilePaystackRenewals } from '@/lib/billing/paystack-renewals.server';
import { sendRenewalReminders } from '@/lib/billing/renewal-reminders.server';
import { sendTrialReminders } from '@/lib/billing/trial-reminders.server';
import logger from '@/lib/logger';

/**
 * GET /api/cron/paystack-renewals — invoked by Vercel Cron (see vercel.json)
 * once a day. Records any Paystack renewal charge the webhook missed, so a
 * paid workspace never turns read-only by mistake, then emails workspaces
 * paying by M-Pesa whose plan runs out soon, and admins whose free trial is
 * ending or has just ended. Guarded by CRON_SECRET, like the other crons.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    // Renewals first, so a workspace that already paid isn't reminded to.
    const result = isPaystackConfigured() ? await reconcilePaystackRenewals() : null;
    const reminders = await sendRenewalReminders();
    const trials = await sendTrialReminders();
    logger.info('Cron Paystack renewal check', {
      ...(result ?? { skipped: 'Paystack not configured' }),
      remindersDue: reminders.due,
      remindersSent: reminders.sent,
      trialRemindersDue: trials.due,
      trialRemindersSent: trials.sent,
    });
    return jsonResponse({ success: (result?.failed ?? 0) === 0, data: { ...(result ?? {}), reminders, trials } });
  } catch (err) {
    logger.error('Cron Paystack renewal check failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Renewal check failed' }, 500);
  }
}
