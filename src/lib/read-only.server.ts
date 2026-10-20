import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { readOnlyReason, READ_ONLY_MESSAGES, type ReadOnlyReason } from './tenant';

export interface ReadOnlyState {
  reason: ReadOnlyReason;
  message: string;
}

/**
 * Whether a workspace is read-only right now, and why — the same rule the
 * middleware enforces, for the website banner and the app. Null = full use.
 */
export async function getReadOnlyState(organizationId: string | null | undefined): Promise<ReadOnlyState | null> {
  if (!organizationId) return null;
  let { data, error } = await supabaseAdmin
    .from('Organization')
    .select('planTier, trialEndsAt, billingStatus, paidThrough')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) {
    // paidThrough not migrated yet (20261017_01).
    ({ data, error } = await supabaseAdmin
      .from('Organization')
      .select('planTier, trialEndsAt, billingStatus')
      .eq('id', organizationId)
      .maybeSingle());
  }
  if (error || !data) return null;
  const reason = readOnlyReason(data as Parameters<typeof readOnlyReason>[0]);
  return reason ? { reason, message: READ_ONLY_MESSAGES[reason] } : null;
}

export interface TrialFields {
  planTier?: string | null;
  billingStatus?: string | null;
  trialEndsAt?: string | null;
}

/**
 * When a workspace's free trial ends, while it is still running; null once it
 * has ended, or for a subscribed, exempt or suspended workspace. Mirrors the
 * trial part of readOnlyReason, so the trial prompt hands over to the
 * read-only banner the moment the trial runs out.
 */
export function activeTrialEndsAt(org: TrialFields, now: Date = new Date()): string | null {
  if (org.planTier !== 'free' || org.billingStatus === 'active' || org.billingStatus === 'suspended' || !org.trialEndsAt) return null;
  const end = Date.parse(org.trialEndsAt);
  return !Number.isNaN(end) && end > now.getTime() ? org.trialEndsAt : null;
}

export async function getActiveTrialEnd(organizationId: string | null | undefined): Promise<string | null> {
  if (!organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('planTier, billingStatus, trialEndsAt')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return activeTrialEndsAt(data as TrialFields);
}

/** Days before an M-Pesa-paid plan runs out that the workspace is reminded to pay again. */
export const RENEWAL_REMINDER_DAYS = 5;

export interface RenewalFields {
  planTier?: string | null;
  billingStatus?: string | null;
  paidThrough?: string | null;
  paystackPlanCode?: string | null;
}

/**
 * When a paid plan that doesn't renew by itself (paid by M-Pesa, so no
 * Paystack card subscription) runs out within RENEWAL_REMINDER_DAYS; null if
 * it renews automatically, is exempt, already lapsed or isn't due yet.
 */
export function manualRenewalDueAt(org: RenewalFields, now: Date = new Date()): string | null {
  if (org.planTier === 'legacy' || org.billingStatus !== 'active' || org.paystackPlanCode || !org.paidThrough) return null;
  const end = Date.parse(org.paidThrough);
  if (Number.isNaN(end) || end <= now.getTime()) return null;
  return end - now.getTime() <= RENEWAL_REMINDER_DAYS * 24 * 60 * 60 * 1000 ? org.paidThrough : null;
}

export async function getManualRenewalDue(organizationId: string | null | undefined): Promise<string | null> {
  if (!organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('planTier, billingStatus, paidThrough, paystackPlanCode')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return manualRenewalDueAt(data as RenewalFields);
}
