import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { getOrgCurrency } from './currency.server';
import { getRate } from './exchange-rates.server';
import logger from './logger';

export interface ExpenseCategory {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
}

export interface Expense {
  id: string;
  organizationId: string;
  shopId: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  description: string | null;
  expenseDate: string;
  recordedBy: string | null;
  createdAt?: string;
}

const DEFAULT_CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Transport', 'Marketing', 'Supplies', 'Other'];

/** Seed a tenant's default categories the first time they're needed. */
async function ensureDefaultCategories(organizationId: string): Promise<void> {
  const { data } = await supabaseAdmin.from('ExpenseCategory').select('id').eq('organizationId', organizationId).limit(1);
  if (data && data.length > 0) return;
  await supabaseAdmin.from('ExpenseCategory').insert(
    DEFAULT_CATEGORIES.map((name) => ({ organizationId, name })),
  );
}

export async function getCategories(organizationId: string, opts: { activeOnly?: boolean } = {}): Promise<ExpenseCategory[]> {
  await ensureDefaultCategories(organizationId);
  let q = supabaseAdmin.from('ExpenseCategory').select('*').eq('organizationId', organizationId);
  if (opts.activeOnly) q = q.eq('isActive', true);
  const { data } = await q.order('name');
  return (data as ExpenseCategory[]) ?? [];
}

export async function createCategory(organizationId: string, name: string): Promise<ExpenseCategory | null> {
  const { data, error } = await supabaseAdmin
    .from('ExpenseCategory')
    .insert([{ organizationId, name: name.trim() }])
    .select('*')
    .maybeSingle();
  if (error) { logger.warn('createCategory failed', { error: error.message }); return null; }
  return data as ExpenseCategory;
}

export async function updateCategory(id: string, organizationId: string, patch: { name?: string; isActive?: boolean }): Promise<ExpenseCategory | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.isActive !== undefined) updates.isActive = patch.isActive;
  const { data, error } = await supabaseAdmin
    .from('ExpenseCategory')
    .update(updates)
    .eq('id', id)
    .eq('organizationId', organizationId)
    .select('*')
    .maybeSingle();
  if (error) { logger.warn('updateCategory failed', { error: error.message }); return null; }
  return (data as ExpenseCategory) ?? null;
}

function mapExpense(row: Record<string, unknown>, categoryName: string | null = null): Expense {
  return {
    id: row.id as string,
    organizationId: row.organizationId as string,
    shopId: (row.shopId as string) ?? null,
    categoryId: (row.categoryId as string) ?? null,
    categoryName,
    amount: Number(row.amount) || 0,
    currency: (row.currency as string) || 'KES',
    exchangeRate: Number(row.exchangeRate) || 1,
    baseAmount: Number(row.baseAmount) || 0,
    description: (row.description as string) ?? null,
    expenseDate: row.expenseDate as string,
    recordedBy: (row.recordedBy as string) ?? null,
    createdAt: row.createdAt as string,
  };
}

/**
 * Resolve category names in one query rather than a PostgREST embed
 * (`ExpenseCategory(name)`). The embed needs a declared FK between Expense and
 * ExpenseCategory; that FK was never created, so the embed returns PGRST200 and
 * every create/list silently failed. Looking the names up ourselves is robust
 * to the schema cache and the missing constraint.
 */
export async function categoryNameMap(organizationId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('ExpenseCategory').select('id, name').eq('organizationId', organizationId).in('id', unique);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((c) => [c.id, c.name]));
}

export async function listExpenses(
  organizationId: string,
  opts: { shopId?: string | null; from?: string; to?: string; categoryId?: string } = {},
): Promise<Expense[]> {
  let q = supabaseAdmin
    .from('Expense')
    .select('*')
    .eq('organizationId', organizationId)
    .is('deletedAt', null);
  if (opts.shopId) q = q.eq('shopId', opts.shopId);
  if (opts.categoryId) q = q.eq('categoryId', opts.categoryId);
  if (opts.from) q = q.gte('expenseDate', opts.from);
  if (opts.to) q = q.lte('expenseDate', opts.to);
  const { data } = await q.order('expenseDate', { ascending: false }).limit(500);
  const rows = (data as Record<string, unknown>[]) ?? [];
  const names = await categoryNameMap(organizationId, rows.map((r) => r.categoryId as string | null));
  return rows.map((r) => mapExpense(r, names.get(r.categoryId as string) ?? null));
}

/** Total operating expenses (in base currency) over a window — used for Net Profit. */
export async function expenseTotalBase(organizationId: string, opts: { shopId?: string | null; from?: string; to?: string } = {}): Promise<number> {
  let q = supabaseAdmin.from('Expense').select('baseAmount').eq('organizationId', organizationId).is('deletedAt', null);
  if (opts.shopId) q = q.eq('shopId', opts.shopId);
  if (opts.from) q = q.gte('expenseDate', opts.from);
  if (opts.to) q = q.lte('expenseDate', opts.to);
  const { data } = await q;
  return ((data as { baseAmount?: number }[]) ?? []).reduce((s, r) => s + (Number(r.baseAmount) || 0), 0);
}

export async function createExpense(
  organizationId: string,
  input: { shopId?: string | null; categoryId?: string | null; amount: number; currency?: string; description?: string | null; expenseDate?: string; recordedBy?: string | null },
): Promise<{ ok: true; expense: Expense } | { ok: false; error: string }> {
  const { currency: baseCurrency } = await getOrgCurrency(organizationId);
  const currency = input.currency && /^[A-Za-z]{3}$/.test(input.currency) ? input.currency.toUpperCase() : baseCurrency;
  let exchangeRate = 1;
  if (currency !== baseCurrency) {
    const r = await getRate(currency, baseCurrency, { organizationId });
    if (r == null || r <= 0) return { ok: false, error: `No exchange rate for ${currency}→${baseCurrency}. Sync rates or set a manual override first.` };
    exchangeRate = r;
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'amount must be a non-negative number' };

  const row = {
    organizationId,
    shopId: input.shopId ?? null,
    categoryId: input.categoryId ?? null,
    amount,
    currency,
    exchangeRate,
    baseAmount: amount * exchangeRate,
    description: input.description ?? null,
    expenseDate: input.expenseDate || new Date().toISOString().slice(0, 10),
    recordedBy: input.recordedBy ?? null,
  };
  const { data, error } = await supabaseAdmin.from('Expense').insert([row]).select('*').maybeSingle();
  if (error || !data) { logger.warn('createExpense failed', { error: error?.message }); return { ok: false, error: 'Failed to record expense' }; }
  const names = await categoryNameMap(organizationId, [(data as Record<string, unknown>).categoryId as string | null]);
  const r = data as Record<string, unknown>;
  return { ok: true, expense: mapExpense(r, names.get(r.categoryId as string) ?? null) };
}

export async function updateExpense(
  id: string,
  organizationId: string,
  patch: { shopId?: string | null; categoryId?: string | null; amount?: number; currency?: string; description?: string | null; expenseDate?: string },
): Promise<Expense | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.shopId !== undefined) updates.shopId = patch.shopId;
  if (patch.categoryId !== undefined) updates.categoryId = patch.categoryId;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.expenseDate !== undefined) updates.expenseDate = patch.expenseDate;

  // If amount or currency changes, re-resolve the frozen rate + baseAmount.
  if (patch.amount !== undefined || patch.currency !== undefined) {
    const { data: existing } = await supabaseAdmin.from('Expense').select('amount, currency').eq('id', id).eq('organizationId', organizationId).maybeSingle();
    if (!existing) return null;
    const { currency: baseCurrency } = await getOrgCurrency(organizationId);
    const currency = (patch.currency ?? (existing as { currency?: string }).currency ?? baseCurrency).toUpperCase();
    const amount = Number(patch.amount ?? (existing as { amount?: number }).amount ?? 0);
    let rate = 1;
    if (currency !== baseCurrency) {
      const r = await getRate(currency, baseCurrency, { organizationId });
      if (r && r > 0) rate = r;
    }
    updates.amount = amount;
    updates.currency = currency;
    updates.exchangeRate = rate;
    updates.baseAmount = amount * rate;
  }

  const { data, error } = await supabaseAdmin
    .from('Expense')
    .update(updates)
    .eq('id', id)
    .eq('organizationId', organizationId)
    .select('*')
    .maybeSingle();
  if (error) { logger.warn('updateExpense failed', { error: error.message }); return null; }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const names = await categoryNameMap(organizationId, [r.categoryId as string | null]);
  return mapExpense(r, names.get(r.categoryId as string) ?? null);
}

export async function deleteExpense(id: string, organizationId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('Expense')
    .update({ deletedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('organizationId', organizationId);
  if (error) { logger.warn('deleteExpense failed', { error: error.message }); return false; }
  return true;
}
