import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-client';
import { sendEmail } from '@/lib/email/smtp-client';
import { manualRenewalDueAt, type RenewalFields } from '@/lib/read-only.server';
import { recordBillingEvent } from '@/lib/billing.server';
import { getOrgUrlFor } from '@/lib/urls';
import type { Organization } from '@/lib/types';
import logger from '@/lib/logger';

// A plan paid by M-Pesa doesn't renew by itself, so the workspace's admins are
// emailed once, a few days before it runs out (the website also shows a
// banner). Each paid period is reminded at most once: the reminder is logged
// as a BillingEvent keyed by the workspace and the period's end.

const EVENT = 'renewal.reminder';

export interface ReminderResult {
  due: number;
  sent: number;
}

type ReminderOrg = RenewalFields & Pick<Organization, 'id' | 'name' | 'slug' | 'customDomain' | 'customDomainStatus'>;

export async function sendRenewalReminders(now: Date = new Date()): Promise<ReminderResult> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('id, name, slug, customDomain, customDomainStatus, planTier, billingStatus, paidThrough, paystackPlanCode')
    .eq('billingStatus', 'active')
    .is('paystackPlanCode', null)
    .gt('paidThrough', now.toISOString());
  if (error) throw new Error(error.message);

  const result: ReminderResult = { due: 0, sent: 0 };
  for (const org of (data ?? []) as ReminderOrg[]) {
    const dueAt = manualRenewalDueAt(org, now);
    if (!dueAt) continue;
    result.due += 1;

    const reference = `${EVENT}:${org.id}:${dueAt}`;
    const { data: already } = await supabaseAdmin.from('BillingEvent').select('id').eq('reference', reference).limit(1).maybeSingle();
    if (already) continue;

    const { data: admins } = await supabaseAdmin
      .from('User')
      .select('email')
      .eq('organizationId', org.id)
      .eq('role', 'admin');
    const emails = ((admins ?? []) as { email?: string | null }[]).map((a) => a.email).filter((e): e is string => Boolean(e));
    if (emails.length === 0) continue;

    const date = new Date(dueAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
    const payUrl = getOrgUrlFor(org, '/settings?tab=billing');
    let delivered = false;
    for (const to of emails) {
      const sent = await sendEmail({
        to,
        subject: `Your RoyalTrack plan ends on ${date}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Time to renew ${escapeHtml(org.name ?? 'your workspace')}</h2>
            <p>Your plan is paid until <strong>${date}</strong>. Plans paid by M-Pesa don't renew by themselves, so pay again before then to keep adding sales and stock.</p>
            <p style="text-align: center; padding: 16px;"><a href="${payUrl}" style="background: #7c3aed; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Pay with M-Pesa</a></p>
            <p>Paying early never loses days: the new period starts when the current one ends. If the plan lapses, your data stays safe and viewable, but changes are paused until it's paid.</p>
          </div>`.trim(),
        text: `Your RoyalTrack plan for ${org.name ?? 'your workspace'} is paid until ${date}. Plans paid by M-Pesa don't renew by themselves. Pay again here: ${payUrl}`,
      });
      delivered ||= sent.ok;
    }
    if (delivered) {
      await recordBillingEvent({ eventType: EVENT, reference, organizationId: org.id, payload: { dueAt, recipients: emails.length } });
      result.sent += 1;
    } else {
      logger.warn('[renewal reminders] email failed', { organizationId: org.id });
    }
  }
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
