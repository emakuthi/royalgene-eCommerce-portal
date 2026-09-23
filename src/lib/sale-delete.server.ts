import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import { incrementCell, decrementCell, hasVariantStock } from './variant-stock.server';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

/** How long a deleted sale stays recoverable before "Empty Trash" is allowed to purge it for good. */
export const SALE_TRASH_RETENTION_DAYS = 90;

export interface SaleDeleteOutcome {
  /** Removed — the row is soft-deleted and its stock effect reversed. */
  deleted: string[];
  /** Not in the caller's organization, or already gone. */
  notFound: string[];
  /** Existed but the delete errored. */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Delete one line item of a sale (one SalesEntry row — the atomic unit a
 * checkout is recorded in: one product, one size/colour cell when the
 * product is variant-tracked, one quantity). This is deliberately the ONLY
 * granularity offered: a multi-item checkout has no separate "sale" row of
 * its own to delete, just the SalesEntry rows sharing a saleGroupId, so
 * "delete this sale" and "delete this one line of a sale" are the same
 * operation — callers wanting to remove a whole checkout just pass every
 * line's id.
 *
 * Soft-deletes (SalesEntry is a `mutable` sync entity — see
 * syncable-entities.ts — so this also propagates as a tombstone to the
 * Android app's local Room cache on its next pull, same as a product
 * delete). The sold quantity is given back to the shop it was sold from —
 * into the matching size/colour cell when the product is variant-tracked,
 * otherwise the flat ShopStock.quantity — with its own StockTransaction
 * audit row, mirroring how a rejected/cancelled stock transfer already
 * returns reserved stock (see stock-transfer.server.ts).
 */
export async function deleteSalesInOrg(
  organizationId: string,
  saleIds: string[],
  deletedByPortalUserId: string | null,
): Promise<SaleDeleteOutcome> {
  const ids = [...new Set(saleIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const outcome: SaleDeleteOutcome = { deleted: [], notFound: [], failed: [] };
  if (ids.length === 0) return outcome;

  const { data: sales, error: fetchError } = await supabaseAdmin
    .from('SalesEntry')
    .select('id, shopId, productId, quantity, size, color, deletedAt')
    .eq('organizationId', organizationId)
    .in('id', ids);

  if (fetchError) {
    logger.error('deleteSalesInOrg: failed to fetch sales', { error: fetchError.message, organizationId });
    for (const id of ids) outcome.failed.push({ id, error: fetchError.message });
    return outcome;
  }

  const byId = new Map((sales ?? []).map((s) => [s.id as string, s]));

  // A sale already reported to KRA (eTIMS) has a TaxInvoice row — deleting it
  // outright, with no corresponding credit note, would leave a filed tax
  // record with nothing behind it. Block those rather than silently erasing
  // a compliance record; the caller sees it as a normal failed id.
  const { data: invoiced } = await supabaseAdmin.from('TaxInvoice').select('salesEntryId').in('salesEntryId', ids);
  const invoicedIds = new Set(((invoiced ?? []) as Array<{ salesEntryId: string }>).map((r) => r.salesEntryId));

  for (const id of ids) {
    const sale = byId.get(id);
    if (!sale || sale.deletedAt) {
      outcome.notFound.push(id);
      continue;
    }
    if (invoicedIds.has(id)) {
      outcome.failed.push({ id, error: 'This sale already has a tax invoice on file and can’t be deleted.' });
      continue;
    }
    try {
      const now = new Date().toISOString();
      const { error: softDeleteError } = await supabaseAdmin
        .from('SalesEntry')
        .update({ deletedAt: now, updatedAt: now })
        .eq('id', id);
      if (softDeleteError) throw new Error(softDeleteError.message);

      await restoreSoldStock(sale as SoldRow, organizationId, deletedByPortalUserId, now);
      outcome.deleted.push(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('deleteSalesInOrg: failed to delete sale', { saleId: id, organizationId, error: message });
      outcome.failed.push({ id, error: message });
    }
  }

  return outcome;
}

interface SoldRow {
  id: string;
  shopId: string;
  productId: string;
  quantity: number;
  size?: string | null;
  color?: string | null;
}

/**
 * Best-effort: the SalesEntry row is already soft-deleted by the time this
 * runs, so a failure here is logged, not thrown — a sale whose stock
 * couldn't be restored is still a deleted sale, not left in limbo.
 */
async function restoreSoldStock(
  sale: SoldRow,
  organizationId: string,
  portalUserId: string | null,
  now: string,
): Promise<void> {
  const { data: shopStock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity')
    .eq('shopId', sale.shopId)
    .eq('productId', sale.productId)
    .maybeSingle();

  if (!shopStock) {
    logger.warn('restoreSoldStock: no ShopStock row to restock — the product may have been removed from this shop since', {
      saleId: sale.id, shopId: sale.shopId, productId: sale.productId,
    });
    return;
  }

  const size = sale.size?.trim() ?? '';
  const color = sale.color?.trim() ?? '';
  const isVariant = (size || color) && (await hasVariantStock(shopStock.id as string));

  if (isVariant) {
    await incrementCell(shopStock.id as string, organizationId, size, color, sale.quantity);
  } else {
    await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: (Number(shopStock.quantity) || 0) + sale.quantity, updatedAt: now })
      .eq('id', shopStock.id);
  }

  try {
    await syncProductStockFromShopStocks(sale.productId);
  } catch (syncErr) {
    logger.warn('restoreSoldStock: failed to sync product stockQuantity', {
      error: syncErr instanceof Error ? syncErr.message : String(syncErr), productId: sale.productId,
    });
  }

  await supabaseAdmin.from('StockTransaction').insert([{
    id: uuidv4(),
    organizationId,
    shopStockId: shopStock.id,
    portalUserId,
    type: 'add',
    quantity: sale.quantity,
    size: isVariant ? size : null,
    color: isVariant ? color : null,
    reason: 'Sale deleted — stock restored',
    reference: `sale-delete-${sale.id}`,
    createdAt: now,
  }]);
}

export interface TrashedSale {
  id: string;
  shopId: string;
  shopName: string | null;
  productId: string;
  productName: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  totalAmount: number;
  entryDate: string;
  deletedAt: string;
  /** When "Empty Trash" is allowed to purge this row for good. */
  purgeEligibleAt: string;
}

/** Every soft-deleted sale still within (or past) its retention window, newest deletion first. */
export async function listTrashedSales(organizationId: string): Promise<TrashedSale[]> {
  const { data, error } = await supabaseAdmin
    .from('SalesEntry')
    .select('id, shopId, productId, size, color, quantity, totalAmount, createdAt, deletedAt')
    .eq('organizationId', organizationId)
    .not('deletedAt', 'is', null)
    .order('deletedAt', { ascending: false });

  if (error) {
    logger.error('listTrashedSales failed', { error: error.message, organizationId });
    return [];
  }
  const rows = (data ?? []) as Array<{ id: string; shopId: string; productId: string; size: string | null; color: string | null; quantity: number; totalAmount: number; createdAt: string; deletedAt: string }>;
  if (rows.length === 0) return [];

  const shopIds = [...new Set(rows.map((r) => r.shopId))];
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const [{ data: shops }, { data: products }] = await Promise.all([
    supabaseAdmin.from('Shop').select('id, name').in('id', shopIds),
    supabaseAdmin.from('Product').select('id, name').in('id', productIds),
  ]);
  const shopName = new Map(((shops ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  const productName = new Map(((products ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    id: r.id,
    shopId: r.shopId,
    shopName: shopName.get(r.shopId) ?? null,
    productId: r.productId,
    productName: productName.get(r.productId) ?? null,
    size: r.size,
    color: r.color,
    quantity: r.quantity,
    totalAmount: Number(r.totalAmount) || 0,
    entryDate: r.createdAt,
    deletedAt: r.deletedAt,
    purgeEligibleAt: new Date(new Date(r.deletedAt).getTime() + SALE_TRASH_RETENTION_DAYS * 86_400_000).toISOString(),
  }));
}

/**
 * Bring a soft-deleted sale back — re-applies its stock effect (undoing the
 * restock [deleteSalesInOrg] did) and clears deletedAt. Fails (without
 * touching anything) if there isn't enough stock left to take back out —
 * the shop may have sold into or transferred away that same stock since the
 * deletion, so this can't just be assumed to always succeed.
 */
export async function restoreSaleFromTrash(
  organizationId: string,
  saleId: string,
  restoredByPortalUserId: string | null,
): Promise<{ ok: true } | { ok: false; error: string; code?: 'NOT_FOUND' | 'INSUFFICIENT_STOCK' }> {
  const { data: sale, error: fetchError } = await supabaseAdmin
    .from('SalesEntry')
    .select('id, shopId, productId, quantity, size, color, deletedAt')
    .eq('id', saleId)
    .eq('organizationId', organizationId)
    .maybeSingle();

  if (fetchError || !sale || !sale.deletedAt) {
    return { ok: false, error: 'Deleted sale not found', code: 'NOT_FOUND' };
  }

  const { data: shopStock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity')
    .eq('shopId', sale.shopId)
    .eq('productId', sale.productId)
    .maybeSingle();

  if (!shopStock) {
    return { ok: false, error: 'This product is no longer stocked at that shop — restore its stock row first', code: 'INSUFFICIENT_STOCK' };
  }

  const size = sale.size?.trim() ?? '';
  const color = sale.color?.trim() ?? '';
  const isVariant = (size || color) && (await hasVariantStock(shopStock.id as string));
  const now = new Date().toISOString();

  if (isVariant) {
    const result = await decrementCell(shopStock.id as string, size, color, sale.quantity);
    if (!result.ok) return { ok: false, error: result.error, code: 'INSUFFICIENT_STOCK' };
  } else {
    if ((Number(shopStock.quantity) || 0) < sale.quantity) {
      return { ok: false, error: `Only ${shopStock.quantity} in stock now — not enough to restore this ${sale.quantity}-unit sale`, code: 'INSUFFICIENT_STOCK' };
    }
    await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: (Number(shopStock.quantity) || 0) - sale.quantity, updatedAt: now })
      .eq('id', shopStock.id);
  }

  const { error: undeleteError } = await supabaseAdmin
    .from('SalesEntry')
    .update({ deletedAt: null, updatedAt: now })
    .eq('id', saleId);
  if (undeleteError) {
    // Stock was already taken back out — put it back rather than leave the
    // sale stuck deleted with its stock effect double-applied.
    if (isVariant) await incrementCell(shopStock.id as string, organizationId, size, color, sale.quantity);
    else await supabaseAdmin.from('ShopStock').update({ quantity: shopStock.quantity, updatedAt: now }).eq('id', shopStock.id);
    return { ok: false, error: undeleteError.message };
  }

  try {
    await syncProductStockFromShopStocks(sale.productId);
  } catch (syncErr) {
    logger.warn('restoreSaleFromTrash: failed to sync product stockQuantity', {
      error: syncErr instanceof Error ? syncErr.message : String(syncErr), productId: sale.productId,
    });
  }

  await supabaseAdmin.from('StockTransaction').insert([{
    id: uuidv4(),
    organizationId,
    shopStockId: shopStock.id,
    portalUserId: restoredByPortalUserId,
    type: 'subtract',
    quantity: -sale.quantity,
    size: isVariant ? size : null,
    color: isVariant ? color : null,
    reason: 'Deleted sale restored from trash',
    reference: `sale-restore-${saleId}`,
    createdAt: now,
  }]);

  return { ok: true };
}

/**
 * "Empty Trash" — permanently erases every soft-deleted sale whose
 * [SALE_TRASH_RETENTION_DAYS] window has passed. Their stock effect was
 * already reversed at delete time, so this only ever removes the row
 * itself — nothing left to undo.
 */
export async function purgeExpiredDeletedSales(organizationId: string): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - SALE_TRASH_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('SalesEntry')
    .delete()
    .eq('organizationId', organizationId)
    .not('deletedAt', 'is', null)
    .lt('deletedAt', cutoff)
    .select('id');

  if (error) {
    logger.error('purgeExpiredDeletedSales failed', { error: error.message, organizationId });
    return { purged: 0 };
  }
  return { purged: data?.length ?? 0 };
}
