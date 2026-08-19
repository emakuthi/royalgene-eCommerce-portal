import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import { recordBillingEvent } from '../billing.server';
import { getSubscriptionRow, syncOrganizationBilling, upsertTenantSubscription } from './tenant-subscription-store.server';
import type { PlatformPlan, SubscriptionStatus, TenantSubscription } from '../types';

/**
 * The single place that changes a tenant's subscription state. Every
 * transition writes TenantSubscription (the authoritative billing-cycle
 * record) and keeps Organization.planTier/billingStatus/trialEndsAt in sync
 * in the same call, so middleware.ts (edge runtime, reads Organization only)
 * never drifts from what the entitlement service (Node runtime, reads
 * TenantSubscription) resolves. Also logs a BillingEvent audit row for every
 * transition — reuses the existing billing.server.ts audit mechanism rather
 * than introducing a second one.
 */

async function getPlan(planId: string): Promise<PlatformPlan | null> {
  const { data } = await supabaseAdmin.from('PlatformPlan').select('*').eq('id', planId).maybeSingle();
  return (data as PlatformPlan | null) ?? null;
}

const writeSubscription = upsertTenantSubscription;
const syncOrganization = syncOrganizationBilling;

export interface AssignPlanInput {
  organizationId: string;
  planId: string;
  status?: SubscriptionStatus;
  billingInterval?: 'monthly' | 'annually' | null;
  actorUserId?: string | null;
}

/** Super-admin or checkout-success path: put a tenant on a specific plan. */
export async function assignPlan(input: AssignPlanInput): Promise<TenantSubscription> {
  const plan = await getPlan(input.planId);
  if (!plan) throw new Error('Plan not found');

  const status = input.status ?? 'active';
  const now = new Date().toISOString();
  const subscription = await writeSubscription(input.organizationId, {
    planId: plan.id,
    status,
    billingInterval: input.billingInterval ?? null,
    currentPeriodStart: status === 'active' ? now : undefined,
  });

  await syncOrganization(input.organizationId, {
    planTier: plan.tier,
    billingStatus: status === 'active' ? 'active' : undefined,
  });

  await recordBillingEvent({
    eventType: 'plan.assigned',
    organizationId: input.organizationId,
    payload: { planId: plan.id, tier: plan.tier, status, actorUserId: input.actorUserId ?? null },
  });

  return subscription;
}

/** Super-admin action: push the trial end date forward without changing plan/status. */
export async function extendTrial(organizationId: string, extraDays: number, actorUserId?: string | null): Promise<TenantSubscription> {
  const existing = await getSubscriptionRow(organizationId);
  const base = existing?.trialEnd && new Date(existing.trialEnd).getTime() > Date.now() ? new Date(existing.trialEnd) : new Date();
  const trialEnd = new Date(base.getTime() + extraDays * 24 * 60 * 60 * 1000).toISOString();

  const subscription = await writeSubscription(organizationId, { status: 'trialing', trialEnd });
  await syncOrganization(organizationId, { trialEndsAt: trialEnd, planTier: 'free' });

  await recordBillingEvent({
    eventType: 'trial.extended',
    organizationId,
    payload: { extraDays, newTrialEnd: trialEnd, actorUserId: actorUserId ?? null },
  });

  return subscription;
}

/** Super-admin action: block new premium usage without touching Organization.status (account-level suspend is a separate, existing control). */
export async function suspendSubscription(organizationId: string, actorUserId?: string | null): Promise<TenantSubscription> {
  const subscription = await writeSubscription(organizationId, { status: 'suspended' });
  await recordBillingEvent({ eventType: 'subscription.suspended', organizationId, payload: { actorUserId: actorUserId ?? null } });
  return subscription;
}

export async function reactivateSubscription(organizationId: string, actorUserId?: string | null): Promise<TenantSubscription> {
  const existing = await getSubscriptionRow(organizationId);
  const stillInTrial = Boolean(existing?.trialEnd && new Date(existing.trialEnd).getTime() > Date.now() && !existing?.planId);
  const status: SubscriptionStatus = stillInTrial ? 'trialing' : 'active';

  const subscription = await writeSubscription(organizationId, { status });
  await syncOrganization(organizationId, { billingStatus: status === 'active' ? 'active' : undefined });
  await recordBillingEvent({ eventType: 'subscription.reactivated', organizationId, payload: { actorUserId: actorUserId ?? null, status } });
  return subscription;
}

/** Tenant admin self-service cancel. Data and account access are preserved — only future premium usage is restricted. */
export async function cancelSubscription(organizationId: string, actorUserId?: string | null): Promise<TenantSubscription> {
  const subscription = await writeSubscription(organizationId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
  await recordBillingEvent({ eventType: 'subscription.cancelled', organizationId, payload: { actorUserId: actorUserId ?? null } });
  return subscription;
}

/**
 * Reconciles a lapsed trial's DB row to 'expired'. entitlement-service.ts's
 * reads already treat a lapsed trial as expired even before this runs (no
 * cron infra in this app), so this is best-effort bookkeeping — call it
 * opportunistically (e.g. from the billing/subscription GET routes) rather
 * than relying on it for correctness.
 */
export async function expireTrialIfLapsed(organizationId: string): Promise<void> {
  const existing = await getSubscriptionRow(organizationId);
  if (!existing || existing.status !== 'trialing' || !existing.trialEnd) return;
  if (new Date(existing.trialEnd).getTime() >= Date.now()) return;

  await writeSubscription(organizationId, { status: 'expired' });
  await recordBillingEvent({ eventType: 'trial.expired', organizationId, payload: {} });
}
