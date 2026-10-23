import 'server-only';
import { supabaseAdmin } from './supabase-client';

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
): Promise<{ id: string; name: string } | null> {
  if (typeof sku !== 'string' || !sku.trim() || !organizationId) return null;
  let query = supabaseAdmin
    .from('Product')
    .select('id, name')
    .eq('organizationId', organizationId)
    .eq('sku', sku.trim());
  if (excludeProductId) query = query.neq('id', excludeProductId);
  const { data } = await query.limit(1);
  return (data?.[0] as { id: string; name: string } | undefined) ?? null;
}

/** A Postgres unique violation on the SKU — the race the pre-check can't close. */
export function isSkuUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === '23505' && /sku/i.test(error.message ?? '');
}

export function duplicateSkuMessage(sku: unknown, otherProductName?: string): string {
  return otherProductName
    ? `SKU "${String(sku).trim()}" is already used by "${otherProductName}". Use a different SKU.`
    : `SKU "${String(sku).trim()}" is already used by another product. Use a different SKU.`;
}

/**
 * Product.sku is NOT NULL, so "no SKU" is stored as '' (which the per-business
 * unique index excludes). A null from a client would fail the column.
 */
export function normalizeSku(sku: unknown): string {
  return typeof sku === 'string' ? sku.trim() : '';
}
