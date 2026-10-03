import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { createExpense } from './expenses.server';
import logger from './logger';

/**
 * Recurring expense templates. A template materialises a real Expense row each
 * time it falls due (see generateDue + the daily cron). The FX rate is frozen
 * per materialised row AT GENERATION TIME by createExpense — the template only
 * stores the amount/currency, never a rate.
 */
export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface RecurringExpense {
  id: string;
  organizationId: string;
  shopId: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  amount: number;
  currency: string;
  description: string | null;
  frequency: Frequency;
  interval: number;
  nextRunDate: string;
  endDate: string | null;
  isActive: boolean;
  lastGeneratedDate: string | null;
}

function mapRow(row: Record<string, unknown>): RecurringExpense {
  const cat = row.ExpenseCategory as { name?: string } | null | undefined;
  return {
    id: row.id as string,
    organizationId: row.organizationId as string,
    shopId: (row.shopId as string) ?? null,
    categoryId: (row.categoryId as string) ?? null,
    categoryName: cat?.name ?? null,
    amount: Number(row.amount) || 0,
    currency: (row.currency as string) || 'KES',
    description: (row.description as string) ?? null,
    frequency: (row.frequency as Frequency) || 'monthly',
    interval: Number(row.interval) || 1,
    nextRunDate: (row.nextRunDate as string)?.slice(0, 10),
    endDate: (row.endDate as string)?.slice(0, 10) ?? null,
    isActive: Boolean(row.isActive),
    lastGeneratedDate: (row.lastGeneratedDate as string)?.slice(0, 10) ?? null,
  };
}

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly'];
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Advance a YYYY-MM-DD date by `interval` periods of `frequency` (UTC, calendar-safe). */
export function advanceDate(dateStr: string, frequency: Frequency, interval: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const n = Math.max(1, interval);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + n);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
  else d.setUTCMonth(d.getUTCMonth() + n); // monthly — JS clamps e.g. Jan 31 +1mo → Feb 28/29
  return d.toISOString().slice(0, 10);
}

export async function listRecurring(organizationId: string): Promise<RecurringExpense[]> {
  const { data } = await supabaseAdmin
    .from('RecurringExpense')
    .select('*, ExpenseCategory(name)')
    .eq('organizationId', organizationId)
    .is('deletedAt', null)
    .order('isActive', { ascending: false })
    .order('nextRunDate', { ascending: true });
  return ((data as Record<string, unknown>[]) ?? []).map(mapRow);
}

export async function createRecurring(
  organizationId: string,
  input: {
    shopId?: string | null;
    categoryId?: string | null;
    amount: number;
    currency?: string;
    description?: string | null;
    frequency?: Frequency;
    interval?: number;
    startDate?: string;
    endDate?: string | null;
    createdBy?: string | null;
  },
): Promise<{ ok: true; recurring: RecurringExpense } | { ok: false; error: string }> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'amount must be a non-negative number' };
  const frequency: Frequency = FREQUENCIES.includes(input.frequency as Frequency) ? (input.frequency as Frequency) : 'monthly';
  const interval = Math.max(1, Math.floor(Number(input.interval) || 1));
  const currency = input.currency && /^[A-Za-z]{3}$/.test(input.currency) ? input.currency.toUpperCase() : undefined;
  const nextRunDate = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : todayStr();

  const row = {
    organizationId,
    shopId: input.shopId ?? null,
    categoryId: input.categoryId ?? null,
    amount,
    currency: currency ?? 'KES',
    description: input.description ?? null,
    frequency,
    interval,
    nextRunDate,
    endDate: input.endDate ?? null,
    isActive: true,
    createdBy: input.createdBy ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from('RecurringExpense')
    .insert([row])
    .select('*, ExpenseCategory(name)')
    .maybeSingle();
  if (error || !data) { logger.warn('createRecurring failed', { error: error?.message }); return { ok: false, error: 'Failed to create recurring expense' }; }
  return { ok: true, recurring: mapRow(data as Record<string, unknown>) };
}

export async function updateRecurring(
  id: string,
  organizationId: string,
  patch: { isActive?: boolean; amount?: number; description?: string | null; endDate?: string | null; categoryId?: string | null; shopId?: string | null },
): Promise<RecurringExpense | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.isActive !== undefined) updates.isActive = patch.isActive;
  if (patch.amount !== undefined) updates.amount = Number(patch.amount);
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.endDate !== undefined) updates.endDate = patch.endDate;
  if (patch.categoryId !== undefined) updates.categoryId = patch.categoryId;
  if (patch.shopId !== undefined) updates.shopId = patch.shopId;
  const { data, error } = await supabaseAdmin
    .from('RecurringExpense')
    .update(updates)
    .eq('id', id)
    .eq('organizationId', organizationId)
    .select('*, ExpenseCategory(name)')
    .maybeSingle();
  if (error) { logger.warn('updateRecurring failed', { error: error.message }); return null; }
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function deleteRecurring(id: string, organizationId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('RecurringExpense')
    .update({ deletedAt: new Date().toISOString(), isActive: false })
    .eq('id', id)
    .eq('organizationId', organizationId);
  if (error) { logger.warn('deleteRecurring failed', { error: error.message }); return false; }
  return true;
}

/**
 * Materialise every due template into Expense rows and roll its schedule
 * forward. Catches up on missed runs (e.g. the cron didn't fire for a few
 * days) by looping until nextRunDate is in the future, capped so a mis-seeded
 * old date can't generate thousands of rows in one pass. Each materialised row
 * gets its own frozen FX rate via createExpense.
 *
 * @param organizationId  limit to one tenant (manual "run due now"); omit to
 *                        sweep every tenant (the cron).
 */
export async function generateDue(organizationId?: string): Promise<{ generated: number; templates: number }> {
  const today = todayStr();
  let q = supabaseAdmin
    .from('RecurringExpense')
    .select('*')
    .eq('isActive', true)
    .is('deletedAt', null)
    .lte('nextRunDate', today);
  if (organizationId) q = q.eq('organizationId', organizationId);
  const { data } = await q;
  const due = (data as Record<string, unknown>[]) ?? [];

  const MAX_CATCHUP = 60; // guard against a mis-seeded far-past nextRunDate
  let generated = 0;

  for (const t of due) {
    const tpl = mapRow(t);
    let runDate = tpl.nextRunDate;
    let iterations = 0;
    let active = true;

    while (runDate <= today && iterations < MAX_CATCHUP) {
      if (tpl.endDate && runDate > tpl.endDate) { active = false; break; }
      const res = await createExpense(tpl.organizationId, {
        shopId: tpl.shopId,
        categoryId: tpl.categoryId,
        amount: tpl.amount,
        currency: tpl.currency,
        description: tpl.description,
        expenseDate: runDate,
        recordedBy: null,
      });
      if (!res.ok) { logger.warn('generateDue: createExpense failed', { id: tpl.id, error: res.error }); break; }
      generated++;
      tpl.lastGeneratedDate = runDate;
      runDate = advanceDate(runDate, tpl.frequency, tpl.interval);
      iterations++;
    }

    if (tpl.endDate && runDate > tpl.endDate) active = false;

    await supabaseAdmin
      .from('RecurringExpense')
      .update({
        nextRunDate: runDate,
        lastGeneratedDate: tpl.lastGeneratedDate,
        isActive: active,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', tpl.id);
  }

  return { generated, templates: due.length };
}
