import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import type { OrgEntitlementOverride } from '../types';

export async function listEntitlementOverridesForOrg(organizationId: string): Promise<OrgEntitlementOverride[]> {
  const { data } = await supabaseAdmin
    .from('OrgEntitlementOverride')
    .select('*')
    .eq('organizationId', organizationId)
    .order('code', { ascending: true });
  return (data as OrgEntitlementOverride[]) ?? [];
}

export interface OrgEntitlementPatch {
  code: string;
  limitValue?: number | null;
  enabled?: boolean;
}

/** Super-admin per-tenant override editor: upserts one or more (code, limitValue) rows for an org in one call. */
export async function upsertOrgEntitlementOverrides(
  organizationId: string,
  patches: OrgEntitlementPatch[],
): Promise<OrgEntitlementOverride[]> {
  const now = new Date().toISOString();
  const rows = patches.map((p) => ({
    organizationId,
    code: p.code,
    ...(p.limitValue !== undefined ? { limitValue: p.limitValue } : {}),
    ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
    updatedAt: now,
  }));

  const { data, error } = await supabaseAdmin
    .from('OrgEntitlementOverride')
    .upsert(rows, { onConflict: 'organizationId,code' })
    .select('*');

  if (error) throw new Error(error.message);
  return (data as OrgEntitlementOverride[]) ?? [];
}

/** Removes the override row for (organizationId, code) — reverts that tenant to its plan's default limit. */
export async function deleteOrgEntitlementOverride(organizationId: string, code: string): Promise<void> {
  const { error } = await supabaseAdmin.from('OrgEntitlementOverride').delete().eq('organizationId', organizationId).eq('code', code);
  if (error) throw new Error(error.message);
}
