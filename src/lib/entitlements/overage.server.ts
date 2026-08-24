import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../supabase-client';
import { getStorageUsageGB } from '../storage-usage.server';
import type { Invoice, InvoiceLineItem, PlanOverageRate } from '../types';
import { getActiveSubscription, getLimit, getUsage } from './entitlement-service.server';
import { LimitCode, WIRED_LIMIT_CODES, type LimitCodeValue, type ResourceTypeValue } from './feature-codes';

const LIMIT_CODE_TO_RESOURCE: Partial<Record<LimitCodeValue, ResourceTypeValue>> = {
  [LimitCode.USERS]: 'USER',
  [LimitCode.BRANCHES]: 'BRANCH',
  [LimitCode.PRODUCTS]: 'PRODUCT',
  [LimitCode.MONTHLY_TRANSACTIONS]: 'TRANSACTION',
};

const LIMIT_LABELS: Record<LimitCodeValue, string> = {
  USERS: 'team members',
  BRANCHES: 'branches/shops',
  WAREHOUSES: 'warehouses',
  PRODUCTS: 'products',
  MONTHLY_TRANSACTIONS: 'monthly transactions',
  STORAGE_GB: 'storage (GB)',
};

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function currentUsageFor(organizationId: string, limitCode: LimitCodeValue): Promise<number> {
  if (limitCode === LimitCode.STORAGE_GB) return getStorageUsageGB(organizationId);
  const resource = LIMIT_CODE_TO_RESOURCE[limitCode];
  if (!resource) return 0;
  return getUsage(organizationId, resource);
}

/**
 * Computes overage line items for every WIRED_LIMIT_CODE that both has a
 * configured PlanOverageRate and currently exceeds its plan limit. Live
 * computation, same philosophy as every other usage check in this module —
 * no running overage counter to keep in sync.
 */
export async function computeOverageLineItems(organizationId: string): Promise<{ overageKobo: number; lineItems: InvoiceLineItem[] }> {
  const ctx = await getActiveSubscription(organizationId);
  if (!ctx || !ctx.plan || ctx.isLegacyUnlimited || !ctx.plan.allowOverage) {
    return { overageKobo: 0, lineItems: [] };
  }

  const { data: rateRows } = await supabaseAdmin
    .from('PlanOverageRate')
    .select('*')
    .eq('planId', ctx.plan.id);
  const rates = (rateRows ?? []) as PlanOverageRate[];
  if (rates.length === 0) return { overageKobo: 0, lineItems: [] };

  const lineItems: InvoiceLineItem[] = [];
  let overageKobo = 0;

  for (const rate of rates) {
    const limitCode = rate.limitCode as LimitCodeValue;
    if (!WIRED_LIMIT_CODES.includes(limitCode)) continue;

    const [limit, usage] = await Promise.all([getLimit(organizationId, limitCode), currentUsageFor(organizationId, limitCode)]);
    if (limit === null || usage <= limit) continue;

    const overageAmount = usage - limit;
    const billableUnits = Math.ceil(overageAmount / Math.max(rate.unit, 1));
    const subtotalKobo = billableUnits * rate.pricePerUnitKobo;
    if (subtotalKobo <= 0) continue;

    overageKobo += subtotalKobo;
    lineItems.push({
      limitCode,
      description: `Overage: ${overageAmount.toLocaleString()} extra ${LIMIT_LABELS[limitCode] ?? limitCode} (${billableUnits} × ${rate.unit} unit${rate.unit === 1 ? '' : 's'})`,
      quantity: billableUnits,
      unitPriceKobo: rate.pricePerUnitKobo,
      subtotalKobo,
    });
  }

  return { overageKobo, lineItems };
}

/**
 * Generates (and idempotently upserts) the current-period invoice for a
 * tenant: base plan price + any overage. One row per (org, period) —
 * re-generating the same period recomputes and overwrites rather than
 * duplicating, since usage may still be changing mid-period.
 */
export async function generateInvoice(organizationId: string, period: string = currentPeriodKey()): Promise<Invoice | null> {
  const ctx = await getActiveSubscription(organizationId);
  if (!ctx || !ctx.plan) return null;

  const basePriceKobo = ctx.subscription?.billingInterval === 'annually' ? ctx.plan.annualPriceKobo : ctx.plan.monthlyPriceKobo;
  const { overageKobo, lineItems } = await computeOverageLineItems(organizationId);
  const totalKobo = basePriceKobo + overageKobo;

  const { data: existing } = await supabaseAdmin
    .from('Invoice')
    .select('id, status')
    .eq('organizationId', organizationId)
    .eq('period', period)
    .maybeSingle();

  const record = {
    organizationId,
    period,
    basePriceKobo,
    overageKobo,
    totalKobo,
    currency: ctx.plan.currency,
    breakdown: lineItems,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    // Never silently rewrite a settled invoice.
    if (existing.status !== 'due') return (await supabaseAdmin.from('Invoice').select('*').eq('id', existing.id).maybeSingle()).data as Invoice | null;
    const { data } = await supabaseAdmin.from('Invoice').update(record).eq('id', existing.id).select().maybeSingle();
    return data as Invoice | null;
  }

  const { data } = await supabaseAdmin
    .from('Invoice')
    .insert([{ id: uuidv4(), ...record, status: 'due', createdAt: new Date().toISOString() }])
    .select()
    .maybeSingle();
  return data as Invoice | null;
}
