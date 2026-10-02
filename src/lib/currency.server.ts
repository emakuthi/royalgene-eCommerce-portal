import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { DEFAULT_CURRENCY } from './currency';

export interface OrgCurrency {
  currency: string;
  usdRate: number | null;
}

/** Resilient read — defaults to KES/no-rate if the row or the (newly added) columns are missing. */
export async function getOrgCurrency(organizationId: string): Promise<OrgCurrency> {
  const { data } = await supabaseAdmin
    .from('Organization')
    .select('currency, usdRate')
    .eq('id', organizationId)
    .maybeSingle();
  if (!data) return { currency: DEFAULT_CURRENCY, usdRate: null };
  const raw = (data as { usdRate?: number | string | null }).usdRate;
  const usdRate = typeof raw === 'number' ? raw : raw == null ? null : Number(raw) || null;
  return {
    currency: (data as { currency?: string }).currency || DEFAULT_CURRENCY,
    usdRate,
  };
}

/** Update base currency and/or the manual USD rate. usdRate=null clears the "≈ $" label. */
export async function updateOrgCurrency(
  organizationId: string,
  patch: { currency?: string; usdRate?: number | null },
): Promise<OrgCurrency> {
  const updates: Record<string, unknown> = {};
  if (patch.currency !== undefined) updates.currency = patch.currency.toUpperCase();
  if (patch.usdRate !== undefined) updates.usdRate = patch.usdRate;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date().toISOString();
    await supabaseAdmin.from('Organization').update(updates).eq('id', organizationId);
  }
  return getOrgCurrency(organizationId);
}
