import 'server-only';
import { supabaseAdmin } from './supabase-client';
import type { PlatformPlan } from './types';
import logger from './logger';
import { upsertTenantSubscription } from './entitlements/tenant-subscription-store.server';
import { disableSubscription, fetchSubscription } from './paystack.server';

export async function recordBillingEvent(input: {
  eventType: string;
  reference?: string | null;
  organizationId?: string | null;
  payload?: unknown;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('BillingEvent').insert([{
    provider: 'paystack',
    eventType: input.eventType,
    reference: input.reference ?? null,
    organizationId: input.organizationId ?? null,
    payload: input.payload ?? null,
    processedAt: new Date().toISOString(),
  }]);
  if (error) logger.warn('[billing] failed to record billing event', { error: error.message, eventType: input.eventType });
}

/** True if this reference has already been applied — guards webhook retries + the verify-endpoint racing the webhook. */
export async function wasReferenceProcessed(reference: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('BillingEvent')
    .select('id')
    .eq('reference', reference)
    .eq('eventType', 'subscription.applied')
    .maybeSingle();
  return Boolean(data);
}

/** One billing period after the later of now and `from`. */
export function addBillingPeriod(from: string | null, interval: 'monthly' | 'annually', now: Date = new Date()): string {
  const start = from && new Date(from).getTime() > now.getTime() ? new Date(from) : new Date(now);
  if (interval === 'annually') start.setUTCFullYear(start.getUTCFullYear() + 1);
  else start.setUTCMonth(start.getUTCMonth() + 1);
  return start.toISOString();
}

export interface ApplySuccessfulSubscriptionInput {
  organizationId: string;
  plan: PlatformPlan;
  interval: 'monthly' | 'annually';
  reference: string;
  paystackCustomerCode?: string | null;
  paystackSubscriptionCode?: string | null;
  /** The Paystack plan the charge was made under; null for a one-off M-Pesa payment, which doesn't renew on its own. */
  paystackPlanCode?: string | null;
  /**
   * The card subscription this checkout replaces (an upgrade or plan change
   * while one still renews), noted at checkout. It is stopped once this
   * payment lands, or the old plan would keep charging the card too.
   */
  replacesSubscriptionCode?: string | null;
}

/**
 * Single source of truth for "a payment succeeded, activate this plan" —
 * called by both the webhook and the checkout-verify endpoint so there's
 * one implementation, not two that can drift. Idempotent per reference.
 */
export async function applySuccessfulSubscription(input: ApplySuccessfulSubscriptionInput): Promise<void> {
  if (await wasReferenceProcessed(input.reference)) return;

  // Each payment (first or renewal) covers one more period, counted from the
  // end of the current one so paying early never loses days.
  const { data: current } = await supabaseAdmin.from('Organization').select('paidThrough').eq('id', input.organizationId).maybeSingle();
  const paidThrough = addBillingPeriod((current as { paidThrough?: string | null } | null)?.paidThrough ?? null, input.interval);

  const orgPatch = {
    planTier: input.plan.tier,
    billingStatus: 'active',
    // Paths that don't know a code (verify, the renewal check) keep the saved one.
    ...(input.paystackCustomerCode ? { paystackCustomerCode: input.paystackCustomerCode } : {}),
    ...(input.paystackSubscriptionCode ? { paystackSubscriptionCode: input.paystackSubscriptionCode } : {}),
    // Set only while a card subscription renews by itself; M-Pesa payers pay each period.
    paystackPlanCode: input.paystackPlanCode ?? null,
    updatedAt: new Date().toISOString(),
  };
  let { error } = await supabaseAdmin.from('Organization').update({ ...orgPatch, paidThrough }).eq('id', input.organizationId);
  if (error) {
    // paidThrough not migrated yet (20261017_01): still activate the plan.
    logger.warn('[billing] paidThrough not saved', { error: error.message, organizationId: input.organizationId });
    ({ error } = await supabaseAdmin.from('Organization').update(orgPatch).eq('id', input.organizationId));
  }

  if (error) {
    logger.error('[billing] failed to apply subscription', { error: error.message, organizationId: input.organizationId });
    throw new Error(error.message);
  }

  // Keep the entitlement system's own record of the subscription in sync —
  // the Organization row above is a denormalized copy middleware.ts reads at
  // the edge; TenantSubscription is what entitlement-service.server.ts
  // actually resolves limits/features against.
  const now = new Date().toISOString();
  await upsertTenantSubscription(input.organizationId, {
    planId: input.plan.id,
    status: 'active',
    billingInterval: input.interval,
    currentPeriodStart: now,
    currentPeriodEnd: paidThrough,
  });

  await recordBillingEvent({
    eventType: 'subscription.applied',
    reference: input.reference,
    organizationId: input.organizationId,
    payload: { planId: input.plan.id, tier: input.plan.tier, interval: input.interval },
  });

  await stopReplacedSubscription(input.organizationId, input.replacesSubscriptionCode ?? null, input.paystackSubscriptionCode ?? null);
}

/** Paystack statuses under which a subscription will still charge the card. */
const STILL_CHARGING = new Set(['active', 'attention']);

/**
 * Stops the card subscription a new checkout replaced. Never throws: the new
 * plan is already paid for and applied; a failure is logged and recorded so
 * it can be stopped by hand in the Paystack dashboard.
 */
export async function stopReplacedSubscription(organizationId: string, oldCode: string | null, newCode: string | null): Promise<void> {
  if (!oldCode || oldCode === newCode) return;
  try {
    const sub = await fetchSubscription(oldCode);
    const result = !sub.ok ? sub : STILL_CHARGING.has(sub.data.status) ? await disableSubscription(oldCode, sub.data.email_token) : { ok: true as const };
    if (result.ok) {
      await recordBillingEvent({ eventType: 'subscription.replaced', organizationId, payload: { stopped: oldCode, replacedBy: newCode } });
    } else {
      logger.error('[billing] could not stop the replaced subscription', { organizationId, subscriptionCode: oldCode, error: result.error });
      await recordBillingEvent({ eventType: 'subscription.replace_failed', organizationId, payload: { subscriptionCode: oldCode, error: result.error } });
    }
    // Forget the old code if it is still the saved one, so Cancel looks up the live subscription instead.
    await supabaseAdmin.from('Organization').update({ paystackSubscriptionCode: null })
      .eq('id', organizationId).eq('paystackSubscriptionCode', oldCode);
  } catch (err) {
    logger.error('[billing] stopReplacedSubscription failed', { organizationId, subscriptionCode: oldCode, error: err instanceof Error ? err.message : String(err) });
  }
}
