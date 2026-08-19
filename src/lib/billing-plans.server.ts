import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { createPaystackPlan } from './paystack.server';
import type { PlatformPlan } from './types';

export async function listPlans(onlyActive = false): Promise<PlatformPlan[]> {
  let query = supabaseAdmin.from('PlatformPlan').select('*').order('displayOrder', { ascending: true });
  if (onlyActive) query = query.eq('isActive', true);
  const { data, error } = await query;
  if (error || !data) return [];
  return data as PlatformPlan[];
}

export async function getPlanById(id: string): Promise<PlatformPlan | null> {
  const { data, error } = await supabaseAdmin.from('PlatformPlan').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as PlatformPlan;
}

export async function getPlanByTier(tier: string): Promise<PlatformPlan | null> {
  const { data, error } = await supabaseAdmin.from('PlatformPlan').select('*').eq('tier', tier).maybeSingle();
  if (error || !data) return null;
  return data as PlatformPlan;
}

export interface CreatePlanInput {
  tier: string;
  code?: string | null;
  name: string;
  description?: string | null;
  monthlyPriceKobo: number;
  annualPriceKobo: number;
  monthlyPriceUSD?: number | null;
  annualPriceUSD?: number | null;
  currency?: string;
  maxShops?: number | null;
  maxUsers?: number | null;
  displayOrder?: number;
}

/**
 * Creates a plan row and opportunistically mints Paystack plan codes for
 * both intervals. Fails soft: if Paystack isn't configured or the calls
 * fail, the row is still created with null codes — checkout for that plan
 * will surface a clear "billing not configured" error until keys are added.
 */
export async function createPlan(input: CreatePlanInput): Promise<PlatformPlan> {
  const currency = input.currency || 'KES';
  const now = new Date().toISOString();

  const [monthlyCode, annualCode] = await Promise.all([
    createPaystackPlan({ name: `${input.name} (Monthly)`, amountKobo: input.monthlyPriceKobo, interval: 'monthly', currency }),
    createPaystackPlan({ name: `${input.name} (Annual)`, amountKobo: input.annualPriceKobo, interval: 'annually', currency }),
  ]);

  const { data, error } = await supabaseAdmin
    .from('PlatformPlan')
    .insert([{
      tier: input.tier,
      code: input.code ?? null,
      name: input.name,
      description: input.description ?? null,
      monthlyPriceKobo: input.monthlyPriceKobo,
      annualPriceKobo: input.annualPriceKobo,
      monthlyPriceUSD: input.monthlyPriceUSD ?? null,
      annualPriceUSD: input.annualPriceUSD ?? null,
      currency,
      paystackMonthlyPlanCode: monthlyCode,
      paystackAnnualPlanCode: annualCode,
      maxShops: input.maxShops ?? null,
      maxUsers: input.maxUsers ?? null,
      isActive: true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    }])
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create plan');
  return data as PlatformPlan;
}

export interface UpdatePlanInput {
  code?: string | null;
  name?: string;
  description?: string | null;
  monthlyPriceUSD?: number | null;
  annualPriceUSD?: number | null;
  maxShops?: number | null;
  maxUsers?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

/**
 * Updates non-price fields freely. Deliberately does NOT accept price
 * changes here — Paystack plans are immutable on amount, so repricing an
 * existing plan (with its already-minted plan codes) would silently
 * desync from what Paystack actually charges. Create a new plan instead.
 */
export async function updatePlan(id: string, input: UpdatePlanInput): Promise<PlatformPlan | null> {
  const { data, error } = await supabaseAdmin
    .from('PlatformPlan')
    .update({ ...input, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PlatformPlan | null;
}

export interface PlanWithEntitlements extends PlatformPlan {
  entitlements: { code: string; enabled: boolean; limitValue: number | null }[];
}

/** For the public pricing page and the super-admin entitlement matrix — the plan catalog plus what each plan actually unlocks, DB as source of truth. */
export async function listPlansWithEntitlements(onlyActive = false): Promise<PlanWithEntitlements[]> {
  const plans = await listPlans(onlyActive);
  if (plans.length === 0) return [];

  const { data: entitlementRows } = await supabaseAdmin
    .from('PlanEntitlement')
    .select('planId, code, enabled, limitValue')
    .in('planId', plans.map((p) => p.id));

  const byPlan = new Map<string, { code: string; enabled: boolean; limitValue: number | null }[]>();
  for (const row of (entitlementRows ?? []) as { planId: string; code: string; enabled: boolean; limitValue: number | null }[]) {
    const list = byPlan.get(row.planId) ?? [];
    list.push({ code: row.code, enabled: row.enabled, limitValue: row.limitValue });
    byPlan.set(row.planId, list);
  }

  return plans.map((plan) => ({ ...plan, entitlements: byPlan.get(plan.id) ?? [] }));
}
