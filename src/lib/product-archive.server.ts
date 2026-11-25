import 'server-only';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase-client';
import { trackFromRequest } from './activity-tracker';
import { jsonResponse } from './apiResponse';

/**
 * Archiving: a product that can't be restocked for now (not in the market) is
 * hidden from stock lists, sale pickers and low-stock counts, and comes back
 * with Unarchive, or by itself as soon as stock is added (a ShopStock trigger,
 * see migration 20261124_02). Only out-of-stock products can be archived, so
 * stock that could still be sold never disappears from view. It applies to
 * every shop's copy of the item at once (see sameItemProducts).
 */

type ArchiveResult =
  | { ok: true; product: { id: string; name: string; archivedAt: string | null }; productIds: string[] }
  | { ok: false; status: number; error: string; code: string };

/** A LIKE pattern that matches `value` exactly (case-insensitively): % and _ in a SKU are literal. */
const exactPattern = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Each shop can hold its own Product row for the same item (SKU is unique per
 * shop), so the item is every live product in the business with this SKU.
 * Archiving only one row would leave the other shops' copies in their
 * out-of-stock lists. Without a SKU the product stands alone.
 */
async function sameItemProducts(
  organizationId: string,
  product: { id: string; kind: string | null; sku: string | null },
): Promise<Array<{ id: string; kind: string | null }>> {
  const sku = product.sku?.trim();
  if (!sku) return [product];
  const { data, error } = await supabaseAdmin
    .from('Product')
    .select('id, kind')
    .eq('organizationId', organizationId)
    .ilike('sku', exactPattern(sku))
    .is('deletedAt', null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; kind: string | null }>;
  return rows.some((r) => r.id === product.id) ? rows : [product, ...rows];
}

export async function setProductArchived(
  organizationId: string,
  productId: string,
  archived: boolean,
  userId: string | null,
): Promise<ArchiveResult> {
  const { data: product, error } = await supabaseAdmin
    .from('Product')
    .select('id, name, kind, sku, deletedAt')
    .eq('id', productId)
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product || product.deletedAt) return { ok: false, status: 404, error: 'Product not found', code: 'NOT_FOUND' };

  const items = await sameItemProducts(organizationId, product);
  const ids = items.map((p) => p.id);

  if (archived) {
    const stocked = items.filter((p) => p.kind !== 'menu').map((p) => p.id);
    if (stocked.length > 0) {
      const { data: stock, error: stockErr } = await supabaseAdmin
        .from('ShopStock')
        .select('quantity')
        .in('productId', stocked)
        .is('deletedAt', null);
      if (stockErr) throw new Error(stockErr.message);
      const onHand = (stock ?? []).reduce((sum: number, r: { quantity: number | string | null }) => sum + Math.max(Number(r.quantity) || 0, 0), 0);
      if (onHand > 0) {
        return {
          ok: false,
          status: 409,
          code: 'HAS_STOCK',
          error: `${product.name} still has ${onHand} in stock. Sell, move or adjust it to 0 before archiving.`,
        };
      }
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from('Product')
    .update({ archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? userId : null })
    .in('id', ids)
    .eq('organizationId', organizationId);
  if (updErr) throw new Error(updErr.message);

  const { data: updated, error: readErr } = await supabaseAdmin
    .from('Product')
    .select('id, name, archivedAt')
    .eq('id', productId)
    .single();
  if (readErr) throw new Error(readErr.message);
  return { ok: true, product: updated, productIds: ids };
}

/** POST body { archived: boolean } — shared by the portal and mobile routes once they've authenticated. */
export async function handleArchiveRequest(
  request: NextRequest,
  payload: Parameters<typeof trackFromRequest>[1] & { userId?: string },
  organizationId: string,
  productId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { archived?: unknown };
  if (typeof body.archived !== 'boolean') {
    return jsonResponse({ success: false, error: '"archived" must be true or false', code: 'VALIDATION_ERROR' }, 400);
  }
  const result = await setProductArchived(organizationId, productId, body.archived, payload?.userId ?? null);
  if (!result.ok) return jsonResponse({ success: false, error: result.error, code: result.code }, result.status);

  await trackFromRequest(request, payload, {
    action: body.archived ? 'product.archive' : 'product.unarchive',
    category: 'product',
    resourceType: 'product',
    resourceId: productId,
    details: { name: result.product.name },
  });
  return jsonResponse({
    success: true,
    data: { ...result.product, productIds: result.productIds },
    message: body.archived
      ? `${result.product.name} archived. It comes back when you unarchive it or add stock.`
      : `${result.product.name} is back in your stock list.`,
  });
}
