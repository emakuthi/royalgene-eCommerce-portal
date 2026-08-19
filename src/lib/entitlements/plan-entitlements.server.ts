import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import type { PlanEntitlement } from '../types';

export async function listEntitlementsForPlan(planId: string): Promise<PlanEntitlement[]> {
  const { data } = await supabaseAdmin.from('PlanEntitlement').select('*').eq('planId', planId).order('code', { ascending: true });
  return (data as PlanEntitlement[]) ?? [];
}

export interface EntitlementPatch {
  code: string;
  enabled?: boolean;
  limitValue?: number | null;
}

/** Super-admin matrix editor: upserts one or more (code, enabled/limitValue) rows for a plan in one call. */
export async function upsertPlanEntitlements(planId: string, patches: EntitlementPatch[]): Promise<PlanEntitlement[]> {
  const now = new Date().toISOString();
  const rows = patches.map((p) => ({
    planId,
    code: p.code,
    ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
    ...(p.limitValue !== undefined ? { limitValue: p.limitValue } : {}),
    updatedAt: now,
  }));

  const { data, error } = await supabaseAdmin
    .from('PlanEntitlement')
    .upsert(rows, { onConflict: 'planId,code' })
    .select('*');

  if (error) throw new Error(error.message);
  return (data as PlanEntitlement[]) ?? [];
}
