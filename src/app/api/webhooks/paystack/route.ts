import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { planCodeOf, verifyWebhookSignature } from '@/lib/paystack.server';
import { forwardWebhook, relayTargetFor } from '@/lib/paystack-relay.server';
import { getPlanById, getPlanByPaystackCode } from '@/lib/billing-plans.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { applySuccessfulSubscription, recordBillingEvent } from '@/lib/billing.server';
import logger from '@/lib/logger';

// POST /api/webhooks/paystack — called by Paystack's servers, not by our
// own frontend. Authenticated via the x-paystack-signature HMAC header
// instead of a portal JWT (see src/lib/tenant.ts TENANT_OPTIONAL_PATHS,
// this path is exempt from tenant resolution too).
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn('[paystack webhook] invalid signature');
    return jsonResponse({ success: false, error: 'Invalid signature' }, 400);
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ success: false, error: 'Invalid payload' }, 400);
  }

  const eventType = event.event || 'unknown';
  const data = event.data || {};
  const reference = typeof data.reference === 'string' ? data.reference : null;

  // This is the Paystack account's only webhook; payments made in other Royal
  // Gene apps (e.g. FleetTrack, "ft-…") are handed to that app untouched and
  // never recorded here. A failed hand-off returns 502 so Paystack retries.
  const relayTo = relayTargetFor(reference);
  if (relayTo) {
    const ok = await forwardWebhook(relayTo, rawBody, signature!);
    if (!ok) logger.warn('[paystack webhook] relay failed', { reference, target: new URL(relayTo).host });
    return jsonResponse({ success: ok }, ok ? 200 : 502);
  }
  const metadata = (data.metadata as Record<string, unknown> | undefined) || {};
  const customer = data.customer as { customer_code?: string } | undefined;
  const paystackPlan = data.plan as { plan_code?: string } | undefined;
  // Renewal charges Paystack makes on its own don't carry our checkout
  // metadata; they're matched by the customer and plan codes instead.
  const organizationId = typeof metadata.organizationId === 'string'
    ? metadata.organizationId
    : await organizationIdForCustomer(customer?.customer_code);

  await recordBillingEvent({ eventType, reference, organizationId, payload: event });

  // Only charge.success actually activates a subscription — other events
  // (subscription.create, invoice.*, etc.) are logged for audit but don't
  // change Organization state yet, per the plan's non-goals.
  if (eventType === 'charge.success' && reference && organizationId) {
    const planId = typeof metadata.planId === 'string' ? metadata.planId : null;
    let interval: 'monthly' | 'annually' = metadata.interval === 'annually' ? 'annually' : 'monthly';
    let plan = planId ? await getPlanById(planId) : null;
    if (!plan && paystackPlan?.plan_code) {
      const match = await getPlanByPaystackCode(paystackPlan.plan_code);
      if (match) ({ plan, interval } = match);
    }

    if (plan) {
      try {
        await applySuccessfulSubscription({
          organizationId,
          plan,
          interval,
          reference,
          paystackCustomerCode: customer?.customer_code ?? null,
          paystackSubscriptionCode: typeof data.subscription_code === 'string' ? data.subscription_code : null,
          paystackPlanCode: planCodeOf(data.plan),
        });
      } catch (err) {
        logger.error('[paystack webhook] failed to apply subscription', { error: err instanceof Error ? err.message : String(err), reference });
        // Still 200 — Paystack would otherwise retry indefinitely on a bug
        // in our own DB write; the event is already logged for manual review.
      }
    } else {
      logger.warn('[paystack webhook] charge.success with unknown planId', { planId, reference });
    }
  }

  // The subscription code (needed to stop auto-renew on cancel) only arrives
  // on subscription.create, not on the charge itself.
  if (eventType === 'subscription.create' && organizationId && typeof data.subscription_code === 'string') {
    await supabaseAdmin.from('Organization').update({ paystackSubscriptionCode: data.subscription_code }).eq('id', organizationId);
  }

  return jsonResponse({ success: true });
}

async function organizationIdForCustomer(customerCode: string | undefined): Promise<string | null> {
  if (!customerCode) return null;
  const { data } = await supabaseAdmin.from('Organization').select('id').eq('paystackCustomerCode', customerCode).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
