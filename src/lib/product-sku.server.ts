import 'server-only';
import { supabaseAdmin } from './supabase-client';

export interface SkuConflict {
  id: string;
  name: string;
  /** Shops that stock the clashing product, so the user knows where to look. */
  shopNames: string[];
}

/**
 * SKUs are unique per business (migration 20261023_02 replaced the old
 * global `Product_sku_key`, which also let only ONE product in the whole
 * platform have a blank SKU). A blank SKU means "none" and never conflicts.
 *
 * Returns the product in `organizationId` that already uses `sku`, ignoring
 * `excludeProductId` (the product being edited), or null if it's free.
 */
export async function findSkuConflict(
  organizationId: string | null | undefined,
  sku: unknown,
  excludeProductId?: string,
): Promise<SkuConflict | null> {
  if (typeof sku !== 'string' || !sku.trim() || !organizationId) return null;
  let query = supabaseAdmin
    .from('Product')
    .select('id, name')
    .eq('organizationId', organizationId)
    .eq('sku', sku.trim());
  if (excludeProductId) query = query.neq('id', excludeProductId);
  const { data } = await query.limit(1);
  const product = data?.[0] as { id: string; name: string } | undefined;
  if (!product) return null;

  // Separate lookups rather than a PostgREST embed — an embed needs a
  // declared FK and 400s the whole query without one.
  const { data: stock } = await supabaseAdmin.from('ShopStock').select('shopId').eq('productId', product.id);
  const shopIds = [...new Set((stock ?? []).map((r: { shopId: string }) => r.shopId))];
  let shopNames: string[] = [];
  if (shopIds.length > 0) {
    const { data: shops } = await supabaseAdmin.from('Shop').select('name').in('id', shopIds);
    shopNames = (shops ?? []).map((s: { name: string }) => s.name).filter(Boolean).sort();
  }
  return { ...product, shopNames };
}

/** A Postgres unique violation on the SKU — the race the pre-check can't close. */
export function isSkuUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === '23505' && /sku/i.test(error.message ?? '');
}

/**
 * e.g. `Duplicate SKU: "T6160-1" is already used by "Mira fashion short" in
 * Main Shop. Please change the SKU and try again.`
 */
export function duplicateSkuMessage(sku: unknown, clash?: SkuConflict | null): string {
  const code = String(sku ?? '').trim();
  const skuPart = code ? `"${code}"` : 'This SKU';
  if (!clash) {
    return `Duplicate SKU: ${skuPart} is already used by another product. Please change the SKU and try again.`;
  }
  const where = clash.shopNames.length > 0 ? ` in ${joinNames(clash.shopNames)}` : '';
  return `Duplicate SKU: ${skuPart} is already used by "${clash.name}"${where}. Please change the SKU and try again.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 3) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more shop${names.length - 3 === 1 ? '' : 's'}`;
}

/**
 * Product.sku is NOT NULL, so "no SKU" is stored as '' (which the per-business
 * unique index excludes). A null from a client would fail the column.
 */
export function normalizeSku(sku: unknown): string {
  return typeof sku === 'string' ? sku.trim() : '';
}
