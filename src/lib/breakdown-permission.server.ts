import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { getVariantMatrix } from './variant-stock.server';
import { hasCapability } from './permissions.server';
import type { VerifiedPayload } from './auth.server';

/** How long after a ShopStock row is created its first breakdown still counts as part of adding it. */
const FIRST_BREAKDOWN_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whether the caller may replace this ShopStock's size/colour breakdown.
 * Changing an existing breakdown is an edit ("edit inventory"). Giving a
 * just-added product its first breakdown is part of adding it, so "add
 * inventory" is enough — the app and portal create the product, then save
 * its cells in a second call, and a shopkeeper allowed to add but not edit
 * used to lose every size/colour that way.
 */
export async function canSetBreakdown(payload: VerifiedPayload, shopStockId: string): Promise<boolean> {
  if (await hasCapability(payload, 'edit_inventory')) return true;
  if (!(await hasCapability(payload, 'add_inventory'))) return false;
  if ((await getVariantMatrix(shopStockId)).cells.length > 0) return false;
  const { data } = await supabaseAdmin.from('ShopStock').select('createdAt').eq('id', shopStockId).maybeSingle();
  const created = data?.createdAt ? Date.parse(data.createdAt as string) : NaN;
  return Number.isFinite(created) && Date.now() - created < FIRST_BREAKDOWN_WINDOW_MS;
}
