import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * Monthly profit-and-loss, in the tenant BASE currency (callers convert to the
 * reporting currency for display). Net = Gross − Operating Expenses.
 *
 *   revenue      = Σ sale.baseAmount
 *   grossProfit  = Σ (sale.baseAmount − costPrice × qty)   [cost is base]
 *   expenses     = Σ expense.baseAmount                     [by expenseDate]
 *   netProfit    = grossProfit − expenses
 *
 * Shop scoping: with a shopId, only that shop's sales AND that shop's expenses
 * count (org-wide expenses — no shopId — are excluded from a single-shop view;
 * they appear in the all-shops view).
 */
export interface PnlMonth {
  month: string; // YYYY-MM
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function buildPnlTrend(
  organizationId: string,
  opts: { shopId?: string | null; months?: number } = {},
): Promise<PnlMonth[]> {
  const months = Math.min(24, Math.max(1, opts.months ?? 6));
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const startIso = start.toISOString();
  const startDate = startIso.slice(0, 10);

  // Sales in window
  let salesQ = supabaseAdmin
    .from('SalesEntry')
    .select('baseAmount, totalAmount, costPrice, quantity, createdAt, shopId')
    .eq('organizationId', organizationId)
    .is('deletedAt', null)
    .gte('createdAt', startIso);
  if (opts.shopId) salesQ = salesQ.eq('shopId', opts.shopId);
  const { data: sales } = await salesQ;

  // Expenses in window (by expenseDate)
  let expQ = supabaseAdmin
    .from('Expense')
    .select('baseAmount, expenseDate, shopId')
    .eq('organizationId', organizationId)
    .is('deletedAt', null)
    .gte('expenseDate', startDate);
  if (opts.shopId) expQ = expQ.eq('shopId', opts.shopId);
  const { data: expenses } = await expQ;

  // Seed all N months with zeros (so empty months still render in the trend)
  const buckets = new Map<string, PnlMonth>();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    buckets.set(monthKey(d), { month: monthKey(d), revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 });
  }

  for (const s of (sales as Record<string, unknown>[]) ?? []) {
    const key = monthKey(new Date(s.createdAt as string));
    const b = buckets.get(key);
    if (!b) continue;
    const base = Number(s.baseAmount ?? s.totalAmount) || 0;
    const cost = (Number(s.costPrice) || 0) * (Number(s.quantity) || 0);
    b.revenue += base;
    b.grossProfit += base - cost;
  }
  for (const e of (expenses as Record<string, unknown>[]) ?? []) {
    const key = monthKey(new Date(`${(e.expenseDate as string).slice(0, 10)}T00:00:00Z`));
    const b = buckets.get(key);
    if (!b) continue;
    b.expenses += Number(e.baseAmount) || 0;
  }
  for (const b of buckets.values()) b.netProfit = b.grossProfit - b.expenses;

  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}
