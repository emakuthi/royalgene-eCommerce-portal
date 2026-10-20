import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-client';
import { sendEmail } from '@/lib/email/smtp-client';
import { activeTrialEndsAt, type TrialFields } from '@/lib/read-only.server';
import { readOnlyReason } from '@/lib/tenant';
import { recordBillingEvent } from '@/lib/billing.server';
import { getOrgUrlFor } from '@/lib/urls';
import type { Organization } from '@/lib/types';
import logger from '@/lib/logger';

// Emails a workspace's admins twice about its free trial: a few days before it
// ends, and once it has ended (the workspace is then read-only). The website
// and app show a banner too. Each email is sent at most once per trial: it is
// logged as a BillingEvent keyed by the stage, the workspace and the trial end.

const EVENT = 'trial.reminder';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The "ending soon" email goes out this many days before the trial ends. */
export const TRIAL_REMINDER_DAYS = 3;
/** A trial that ended longer ago than this gets no "ended" email (e.g. when this first ships). */
const ENDED_LOOKBACK_DAYS = 2;

export type TrialStage = 'ending' | 'ended';

export interface TrialReminderResult {
  due: number;
  sent: number;
}

type TrialOrg = TrialFields & Pick<Organization, 'id' | 'name' | 'slug' | 'customDomain' | 'customDomainStatus'> & { paidThrough?: string | null };

/** Which trial email a workspace is due right now, if any. */
export function trialReminderStage(org: TrialOrg, now: Date = new Date()): TrialStage | null {
  if (!org.trialEndsAt) return null;
  const end = Date.parse(org.trialEndsAt);
  if (Number.isNaN(end)) return null;
  if (activeTrialEndsAt(org, now)) return end - now.getTime() <= TRIAL_REMINDER_DAYS * DAY_MS ? 'ending' : null;
  const ended = readOnlyReason(org as Parameters<typeof readOnlyReason>[0], now.getTime()) === 'trial_ended';
  return ended && now.getTime() - end <= ENDED_LOOKBACK_DAYS * DAY_MS ? 'ended' : null;
}

export async function sendTrialReminders(now: Date = new Date()): Promise<TrialReminderResult> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('id, name, slug, customDomain, customDomainStatus, planTier, billingStatus, trialEndsAt, paidThrough')
    .eq('planTier', 'free')
    .gte('trialEndsAt', new Date(now.getTime() - ENDED_LOOKBACK_DAYS * DAY_MS).toISOString())
    .lte('trialEndsAt', new Date(now.getTime() + TRIAL_REMINDER_DAYS * DAY_MS).toISOString());
  if (error) throw new Error(error.message);

  const result: TrialReminderResult = { due: 0, sent: 0 };
  for (const org of (data ?? []) as TrialOrg[]) {
    const stage = trialReminderStage(org, now);
    if (!stage) continue;
    result.due += 1;

    const reference = `${EVENT}:${stage}:${org.id}:${org.trialEndsAt}`;
    const { data: already } = await supabaseAdmin.from('BillingEvent').select('id').eq('reference', reference).limit(1).maybeSingle();
    if (already) continue;

    const { data: admins } = await supabaseAdmin
      .from('User')
      .select('email')
      .eq('organizationId', org.id)
      .eq('role', 'admin');
    const emails = ((admins ?? []) as { email?: string | null }[]).map((a) => a.email).filter((e): e is string => Boolean(e));
    if (emails.length === 0) continue;

    const message = trialEmail(org, stage);
    let delivered = false;
    for (const to of emails) {
      const sent = await sendEmail({ to, ...message });
      delivered ||= sent.ok;
    }
    if (delivered) {
      await recordBillingEvent({ eventType: EVENT, reference, organizationId: org.id, payload: { stage, trialEndsAt: org.trialEndsAt, recipients: emails.length } });
      result.sent += 1;
    } else {
      logger.warn('[trial reminders] email failed', { organizationId: org.id, stage });
    }
  }
  return result;
}

function trialEmail(org: TrialOrg, stage: TrialStage): { subject: string; html: string; text: string } {
  const name = org.name ?? 'your workspace';
  const date = new Date(org.trialEndsAt as string).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });
  const payUrl = getOrgUrlFor(org, '/settings?tab=billing');
  const button = `<p style="text-align: center; padding: 16px;"><a href="${payUrl}" style="background: #7c3aed; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Choose a plan</a></p>`;
  if (stage === 'ending') {
    return {
      subject: `Your RoyalTrack free trial ends on ${date}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Your free trial ends soon</h2>
          <p>The free trial for ${escapeHtml(name)} ends on <strong>${date}</strong>. Subscribe before then to keep recording sales and stock without a break. You can pay by card or M-Pesa.</p>
          ${button}
          <p>If you don't subscribe, your data stays safe and viewable, but changes are paused until you do.</p>
        </div>`.trim(),
      text: `The RoyalTrack free trial for ${name} ends on ${date}. Subscribe before then to keep recording: ${payUrl}`,
    };
  }
  return {
    subject: 'Your RoyalTrack free trial has ended',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your free trial has ended</h2>
        <p>The free trial for ${escapeHtml(name)} ended on <strong>${date}</strong>, so the workspace is now read-only. Everything you recorded is safe and you can still view and export it.</p>
        <p>Subscribe to start recording sales and stock again. You can pay by card or M-Pesa.</p>
        ${button}
      </div>`.trim(),
    text: `The RoyalTrack free trial for ${name} ended on ${date}, so the workspace is read-only. Subscribe to keep recording: ${payUrl}`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
