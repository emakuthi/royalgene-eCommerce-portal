import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-client';
import { fetchCustomerId, listSuccessfulTransactions, planCodeOf, type PaystackListedTransaction } from '@/lib/paystack.server';
import { relayTargetFor } from '@/lib/paystack-relay.server';
import { getPlanById, getPlanByPaystackCode } from '@/lib/billing-plans.server';
import { applySuccessfulSubscription, recordBillingEvent, wasReferenceProcessed } from '@/lib/billing.server';
import type { PlatformPlan } from '@/lib/types';
import logger from '@/lib/logger';

// Safety net for the Paystack webhook. Paystack renews a subscription by
// charging the card on its own; the only way we hear about it is the
// charge.success webhook. If that is ever missed (URL misconfigured, outage,
// retries exhausted) a paid workspace would turn read-only once paidThrough +
// the grace days pass. Once a day this asks Paystack directly for each
// workspace that is due, and applies any successful charge we haven't seen —
// through the same idempotent path the webhook uses, so a charge is never
// counted twice whichever path sees it first.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Check workspaces whose paid period ends within this many days ... */
const DUE_AHEAD_DAYS = 2;
/** ... or ended at most this many days ago (a lapsed card can still be retried and pay late). */
const LAPSED_BEHIND_DAYS = 45;
/** Renewal charges can land a little before paidThrough. */
const LOOKBACK_DAYS = 7;

export interface RenewalCheckResult {
  checked: number;
  applied: number;
  failed: number;
}

interface DueOrganization {
  id: string;
  paystackCustomerCode: string;
  paidThrough: string;
}

export async function reconcilePaystackRenewals(now: Date = new Date()): Promise<RenewalCheckResult> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('id, paystackCustomerCode, paidThrough')
    .not('paystackCustomerCode', 'is', null)
    .gt('paidThrough', new Date(now.getTime() - LAPSED_BEHIND_DAYS * DAY_MS).toISOString())
    .lt('paidThrough', new Date(now.getTime() + DUE_AHEAD_DAYS * DAY_MS).toISOString());
  if (error) throw new Error(error.message);

  const result: RenewalCheckResult = { checked: 0, applied: 0, failed: 0 };
  for (const org of (data ?? []) as DueOrganization[]) {
    result.checked += 1;
    try {
      result.applied += await reconcileOrganization(org);
    } catch (err) {
      result.failed += 1;
      logger.error('[paystack renewals] check failed', { organizationId: org.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

async function reconcileOrganization(org: DueOrganization): Promise<number> {
  const customerId = await fetchCustomerId(org.paystackCustomerCode);
  if (customerId === null) throw new Error('Paystack customer not found');

  const from = new Date(new Date(org.paidThrough).getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const list = await listSuccessfulTransactions(customerId, from);
  if (!list.ok) throw new Error(list.error);

  // Oldest first: each payment extends paidThrough by one period from where the last left it.
  const transactions = [...list.data].sort((a, b) => paidAt(a) - paidAt(b));

  let applied = 0;
  for (const tx of transactions) {
    if (tx.status !== 'success' || !tx.reference) continue;
    // One customer can also pay in other Royal Gene apps (FleetTrack "ft-…").
    if (relayTargetFor(tx.reference)) continue;
    if (await wasReferenceProcessed(tx.reference)) continue;

    const metadata = parseMetadata(tx.metadata);
    if (typeof metadata.organizationId === 'string' && metadata.organizationId !== org.id) continue;

    const match = await planFor(tx, metadata);
    if (!match) continue; // not a RoyalTrack subscription payment

    await recordBillingEvent({ eventType: 'charge.success.reconciled', reference: tx.reference, organizationId: org.id, payload: tx });
    await applySuccessfulSubscription({
      organizationId: org.id,
      plan: match.plan,
      interval: match.interval,
      reference: tx.reference,
      paystackCustomerCode: org.paystackCustomerCode,
      paystackPlanCode: planCodeOf(tx.plan) ?? planCodeOf(tx.plan_object),
    });
    logger.warn('[paystack renewals] applied a charge the webhook missed', { organizationId: org.id, reference: tx.reference });
    applied += 1;
  }
  return applied;
}

async function planFor(
  tx: PaystackListedTransaction,
  metadata: Record<string, unknown>,
): Promise<{ plan: PlatformPlan; interval: 'monthly' | 'annually' } | null> {
  if (typeof metadata.planId === 'string') {
    const plan = await getPlanById(metadata.planId);
    if (plan) return { plan, interval: metadata.interval === 'annually' ? 'annually' : 'monthly' };
  }
  const planCode = planCodeOf(tx.plan) ?? planCodeOf(tx.plan_object);
  return planCode ? getPlanByPaystackCode(planCode) : null;
}

function paidAt(tx: PaystackListedTransaction): number {
  return Date.parse(tx.paid_at || tx.created_at || '') || 0;
}

/** Paystack returns metadata as an object, a JSON string, or "" when none was sent. */
function parseMetadata(raw: PaystackListedTransaction['metadata']): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
