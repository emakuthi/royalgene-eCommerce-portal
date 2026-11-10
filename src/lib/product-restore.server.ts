import 'server-only';
import { supabaseAdmin } from './supabase-client';

export interface DeletedProductShop {
  shopId: string;
  shopName: string | null;
  quantity: number;
  movements: number;
}

export interface DeletedProduct {
  id: string;
  name: string | null;
  sku: string | null;
  deletedAt: string;
  deletedBy: string | null;
  /** What Restore would bring back. Empty for a product deleted before stock was being saved. */
  shops: DeletedProductShop[];
}

export type RestoreSkipReason = 'SHOP_GONE' | 'ALREADY_STOCKED' | 'SKU_TAKEN';

export type RestoreResult =
  | { ok: true; restored: string[]; skipped: Array<{ shopId: string; reason: RestoreSkipReason }> }
  | { ok: false; code: 'NOT_FOUND' | 'NOTHING_TO_RESTORE'; skipped?: Array<{ shopId: string; reason: RestoreSkipReason }> };

interface SavedStock {
  productId: string;
  shopId: string;
  stock: { quantity?: number | string } | null;
  transactions: unknown[] | null;
  deletedAt: string;
}

/**
 * Whole products that were deleted, plus products still live that were removed
 * from one shop, because to whoever ran that shop those look just the same.
 */
export async function listDeletedProducts(organizationId: string): Promise<DeletedProduct[]> {
  const [{ data: deleted, error: deletedErr }, { data: saved, error: savedErr }] = await Promise.all([
    supabaseAdmin.from('Product').select('id, name, sku, deletedAt')
      .eq('organizationId', organizationId).not('deletedAt', 'is', null).is('purgedAt', null),
    supabaseAdmin.from('DeletedShopStock').select('productId, shopId, stock, transactions, deletedAt')
      .eq('organizationId', organizationId).is('restoredAt', null).order('deletedAt', { ascending: false }),
  ]);
  if (deletedErr) throw new Error(deletedErr.message);
  if (savedErr) throw new Error(savedErr.message);

  // Newest copy per shop, the same one restore_deleted_product uses.
  const byProduct = new Map<string, Map<string, SavedStock>>();
  for (const row of (saved ?? []) as SavedStock[]) {
    const shops = byProduct.get(row.productId) ?? new Map<string, SavedStock>();
    if (!shops.has(row.shopId)) shops.set(row.shopId, row);
    byProduct.set(row.productId, shops);
  }

  const products = new Map((deleted ?? []).map((p) => [p.id as string, p]));
  const missing = [...byProduct.keys()].filter((id) => !products.has(id));
  if (missing.length > 0) {
    const { data: live } = await supabaseAdmin.from('Product').select('id, name, sku, deletedAt')
      .eq('organizationId', organizationId).in('id', missing);
    (live ?? []).forEach((p) => products.set(p.id as string, p));
  }

  // A live product put back in a shop isn't missing from that shop any more.
  const liveIds = [...products.values()].filter((p) => !p.deletedAt).map((p) => p.id as string);
  if (liveIds.length > 0) {
    const { data: stocked } = await supabaseAdmin.from('ShopStock').select('productId, shopId').in('productId', liveIds);
    (stocked ?? []).forEach((s) => byProduct.get(s.productId as string)?.delete(s.shopId as string));
    liveIds.filter((id) => !byProduct.get(id)?.size).forEach((id) => products.delete(id));
  }

  const ids = [...products.keys()];
  if (ids.length === 0) return [];

  const shopIds = [...new Set([...byProduct.values()].flatMap((shops) => [...shops.keys()]))];
  const { data: shopRows } = shopIds.length
    ? await supabaseAdmin.from('Shop').select('id, name').in('id', shopIds)
    : { data: [] };
  const shopNames = new Map((shopRows ?? []).map((s) => [s.id as string, s.name as string]));

  const { data: logs } = await supabaseAdmin.from('activity_logs').select('resource_id, user_id, user_email, created_at')
    .eq('organization_id', organizationId).eq('action', 'product.delete').in('resource_id', ids)
    .order('created_at', { ascending: false });
  const lastDelete = new Map<string, { user_id: string | null; user_email: string | null }>();
  (logs ?? []).forEach((l) => { if (!lastDelete.has(l.resource_id)) lastDelete.set(l.resource_id, l); });
  const userIds = [...new Set([...lastDelete.values()].map((l) => l.user_id).filter(Boolean))] as string[];
  const { data: users } = userIds.length
    ? await supabaseAdmin.from('User').select('id, name').in('id', userIds)
    : { data: [] };
  const userNames = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));

  return ids.map((id) => {
    const product = products.get(id)!;
    const shops = [...(byProduct.get(id)?.values() ?? [])];
    const log = lastDelete.get(id);
    return {
      id,
      name: (product.name as string) ?? null,
      sku: (product.sku as string) ?? null,
      deletedAt: (product.deletedAt as string) ?? shops[0]?.deletedAt,
      deletedBy: log ? (log.user_id && userNames.get(log.user_id)) || log.user_email : null,
      shops: shops.map((s) => ({
        shopId: s.shopId,
        shopName: shopNames.get(s.shopId) ?? null,
        quantity: Number(s.stock?.quantity ?? 0),
        movements: s.transactions?.length ?? 0,
      })),
    };
  }).sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
}

export async function restoreDeletedProduct(organizationId: string, productId: string): Promise<RestoreResult> {
  const { data, error } = await supabaseAdmin.rpc('restore_deleted_product', {
    p_organization_id: organizationId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return data as RestoreResult;
}

export type PurgeResult = { ok: true; erased: boolean } | { ok: false; code: 'NOT_FOUND' };

/**
 * "Delete permanently" from Deleted Products. Never touches history: a product with
 * sales (trashed ones included), shop orders, stock transfers or recipe lines keeps its row, marked
 * purged, so that history still has its name; one with none of these is erased. Its
 * saved stock goes either way, so it can't be restored. A live product that was only
 * removed from a shop just loses that saved copy and leaves the list.
 */
export async function purgeDeletedProduct(organizationId: string, productId: string): Promise<PurgeResult> {
  const { data: product, error } = await supabaseAdmin.from('Product').select('id, deletedAt, purgedAt')
    .eq('organizationId', organizationId).eq('id', productId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!product || product.purgedAt) return { ok: false, code: 'NOT_FOUND' };

  const { error: savedErr } = await supabaseAdmin.from('DeletedShopStock').delete()
    .eq('organizationId', organizationId).eq('productId', productId).is('restoredAt', null);
  if (savedErr) throw new Error(savedErr.message);
  if (!product.deletedAt) return { ok: true, erased: false };

  // Rows that would block or lose something if the product row went: sales and orders
  // block the delete; transfers and recipe lines (as dish or ingredient) would cascade.
  const checks: Array<[string, string]> = [
    ['SalesEntry', `productId.eq.${productId}`],
    ['OrderItem', `productId.eq.${productId}`],
    ['StockTransfer', `productId.eq.${productId}`],
    ['RecipeItem', `productId.eq.${productId},ingredientProductId.eq.${productId}`],
  ];
  const counts = await Promise.all(checks.map(async ([table, filter]) => {
    const { count, error: countErr } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).or(filter);
    if (countErr) throw new Error(countErr.message);
    return count ?? 0;
  }));

  if (counts.every((n) => n === 0)) {
    const { error: deleteErr } = await supabaseAdmin.from('Product').delete().eq('id', productId);
    // Anything else still pointing at it blocks the delete; marking it purged is just as final.
    if (!deleteErr) return { ok: true, erased: true };
  }

  const now = new Date().toISOString();
  const { error: markErr } = await supabaseAdmin.from('Product').update({ purgedAt: now, updatedAt: now }).eq('id', productId);
  if (markErr) throw new Error(markErr.message);
  return { ok: true, erased: false };
}
