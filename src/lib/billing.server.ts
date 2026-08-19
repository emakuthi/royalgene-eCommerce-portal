import 'server-only';
import { supabaseAdmin } from './supabase-client';
import type { PlatformPlan } from './types';
import logger from './logger';

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

export interface ApplySuccessfulSubscriptionInput {
  organizationId: string;
  plan: PlatformPlan;
  interval: 'monthly' | 'annually';
  reference: string;
  paystackCustomerCode?: string | null;
  paystackSubscriptionCode?: string | null;
}

/**
 * Single source of truth for "a payment succeeded, activate this plan" —
 * called by both the webhook and the checkout-verify endpoint so there's
 * one implementation, not two that can drift. Idempotent per reference.
 */
export async function applySuccessfulSubscription(input: ApplySuccessfulSubscriptionInput): Promise<void> {
  if (await wasReferenceProcessed(input.reference)) return;

  const planCode = input.interval === 'annually' ? input.plan.paystackAnnualPlanCode : input.plan.paystackMonthlyPlanCode;

  const { error } = await supabaseAdmin
    .from('Organization')
    .update({
      planTier: input.plan.tier,
      billingStatus: 'active',
      paystackCustomerCode: input.paystackCustomerCode ?? null,
      paystackSubscriptionCode: input.paystackSubscriptionCode ?? null,
      paystackPlanCode: planCode ?? null,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', input.organizationId);

  if (error) {
    logger.error('[billing] failed to apply subscription', { error: error.message, organizationId: input.organizationId });
    throw new Error(error.message);
  }

  await recordBillingEvent({
    eventType: 'subscription.applied',
    reference: input.reference,
    organizationId: input.organizationId,
    payload: { planId: input.plan.id, tier: input.plan.tier, interval: input.interval },
  });
}
