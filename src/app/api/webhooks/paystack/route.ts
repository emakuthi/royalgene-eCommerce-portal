import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyWebhookSignature } from '@/lib/paystack.server';
import { getPlanById } from '@/lib/billing-plans.server';
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
  const metadata = (data.metadata as Record<string, unknown> | undefined) || {};
  const organizationId = typeof metadata.organizationId === 'string' ? metadata.organizationId : null;

  await recordBillingEvent({ eventType, reference, organizationId, payload: event });

  // Only charge.success actually activates a subscription — other events
  // (subscription.create, invoice.*, etc.) are logged for audit but don't
  // change Organization state yet, per the plan's non-goals.
  if (eventType === 'charge.success' && reference && organizationId) {
    const planId = typeof metadata.planId === 'string' ? metadata.planId : null;
    const interval = metadata.interval === 'annually' ? 'annually' : 'monthly';
    const plan = planId ? await getPlanById(planId) : null;

    if (plan) {
      const customer = data.customer as { customer_code?: string } | undefined;
      try {
        await applySuccessfulSubscription({
          organizationId,
          plan,
          interval,
          reference,
          paystackCustomerCode: customer?.customer_code ?? null,
          paystackSubscriptionCode: typeof data.subscription_code === 'string' ? data.subscription_code : null,
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

  return jsonResponse({ success: true });
}
