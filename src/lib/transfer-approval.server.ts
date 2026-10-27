import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import logger from './logger';
import { productUnit } from './business-settings.server';
import { quantityError } from './business-types';
import { hasVariantStock } from './variant-stock.server';
import { resolveTransferDestination } from './product-sku.server';
import { idempotentInsert } from './sync/idempotent-insert.server';
import { assertFeatureEnabled } from './entitlements/enforce.server';
import { FeatureCode } from './entitlements/feature-codes';
import {
  addVariantCells, normalizeTransferCells, returnReservedStock, returnVariantCells, takeVariantCells, type TransferCell,
} from './stock-transfer.server';

/**
 * Every stock transfer waits for the receiving shop to approve it. Sending
 * takes the stock off the source straight away (held for the transfer, so
 * it can't be sold twice) and records it leaving; nothing reaches the
 * receiving shop until someone there approves. Rejecting, or the sender
 * cancelling, puts the held stock back. A StockTransfer row (kind 'request')
 * tracks each one: pending -> confirmed | rejected | cancelled.
 *
 * Products tracked by size/colour move cell by cell; `variants` on the row
 * says which. Shared by the mobile transfer + transfer-request routes and
 * the portal's.
 */

export type TransferFailure = { ok: false; status: number; code: string; error: string };
type TransferRow = Record<string, unknown> & { id: string };

const fail = (status: number, code: string, error: string): TransferFailure => ({ ok: false, status, code, error });
const ref = (id: string) => `transfer-request-${id}`;
const noteSuffix = (notes: unknown) => (typeof notes === 'string' && notes.trim() ? ` — ${notes.trim()}` : '');

async function syncProducts(...productIds: Array<string | null | undefined>) {
  for (const id of new Set(productIds.filter(Boolean) as string[])) {
    try {
      await syncProductStockFromShopStocks(id);
    } catch (err) {
      logger.warn('transfer: failed to sync product stockQuantity', { productId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Compare-and-set on a plain ShopStock count, so a sale landing at the same moment isn't overwritten. */
async function adjustFlatStock(shopStockId: string, delta: number): Promise<{ ok: true } | { ok: false; available: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await supabaseAdmin.from('ShopStock').select('quantity').eq('id', shopStockId).maybeSingle();
    const current = Number(row?.quantity) || 0;
    if (current + delta < 0) return { ok: false, available: current };
    const { data: updated } = await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: current + delta, updatedAt: new Date().toISOString() })
      .eq('id', shopStockId)
      .eq('quantity', current)
      .select('id');
    if (updated && updated.length > 0) return { ok: true };
  }
  return { ok: false, available: -1 };
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * What a send needs, found from the request: the source ShopStock (by
 * Product.id, or ShopStock.id from older clients), its business — with the
 * transfer feature on — and a receiving shop in that same business.
 */
export async function prepareSend(opts: { fromShopId: string; productId: unknown; toShopId: unknown }): Promise<
  | { ok: true; organizationId: string; srcStock: { id: string; productId: string; quantity: number }; toShop: { id: string; name: string } }
  | TransferFailure
  | { ok: false; response: Response }
> {
  const { fromShopId, productId, toShopId } = opts;
  if (typeof productId !== 'string' || !productId || typeof toShopId !== 'string' || !toShopId) {
    return fail(400, 'VALIDATION_ERROR', 'productId, toShopId, and quantity are required');
  }
  if (fromShopId === toShopId) return fail(400, 'VALIDATION_ERROR', 'Source and destination shops must be different');
  const cols = 'id, productId, quantity';
  let { data: src } = await supabaseAdmin.from('ShopStock').select(cols).eq('shopId', fromShopId).eq('productId', productId).maybeSingle();
  if (!src) ({ data: src } = await supabaseAdmin.from('ShopStock').select(cols).eq('shopId', fromShopId).eq('id', productId).maybeSingle());
  if (!src) return fail(404, 'NOT_FOUND', 'Product not found in source shop');

  const { data: srcShop } = await supabaseAdmin.from('Shop').select('organizationId').eq('id', fromShopId).maybeSingle();
  if (!srcShop) return fail(404, 'NOT_FOUND', 'Source shop not found');
  const organizationId = srcShop.organizationId as string;
  const featureResponse = await assertFeatureEnabled(organizationId, FeatureCode.STOCK_TRANSFER);
  if (featureResponse) return { ok: false, response: featureResponse };

  const { data: destShop } = await supabaseAdmin.from('Shop').select('id, name, organizationId').eq('id', toShopId).maybeSingle();
  if (!destShop) return fail(404, 'NOT_FOUND', 'Destination shop not found');
  // Without this, stock could be sent straight into another business's shop.
  if (destShop.organizationId !== organizationId) return fail(403, 'FORBIDDEN', 'Destination shop must belong to the same organization');

  return {
    ok: true,
    organizationId,
    srcStock: { id: src.id as string, productId: src.productId as string, quantity: Number(src.quantity) || 0 },
    toShop: { id: destShop.id as string, name: destShop.name as string },
  };
}

export async function sendTransfer(opts: {
  /** Client id — a retry with the same id returns the first attempt's row and changes nothing. */
  id?: string | null;
  organizationId: string;
  srcStock: { id: string; productId: string; quantity: number };
  fromShopId: string;
  toShop: { id: string; name: string };
  quantity?: unknown;
  variants?: unknown;
  notes?: string | null;
  portalUserId: string | null;
}): Promise<{ ok: true; created: boolean; transfer: TransferRow } | TransferFailure> {
  const { organizationId, srcStock, fromShopId, toShop, notes, portalUserId } = opts;
  if (fromShopId === toShop.id) return fail(400, 'VALIDATION_ERROR', 'Source and destination shops must be different');

  const unit = await productUnit(srcStock.productId);
  let cells: TransferCell[] | null = null;
  let quantity = Number(opts.quantity);
  if (await hasVariantStock(srcStock.id)) {
    const parsed = normalizeTransferCells(opts.variants, unit);
    if (!parsed.ok) return fail(400, 'VARIANTS_REQUIRED', parsed.error);
    cells = parsed.cells;
    quantity = parsed.total;
  } else {
    const problem = !Number.isFinite(quantity) || quantity <= 0 ? 'quantity must be a positive number' : quantityError(quantity, unit);
    if (problem) return fail(400, 'VALIDATION_ERROR', problem);
    if (Number(srcStock.quantity) < quantity) {
      return fail(400, 'INSUFFICIENT_STOCK', `Insufficient stock. Available: ${srcStock.quantity}, requested: ${quantity}`);
    }
  }

  // Checked now so the sender hears about a same-SKU clash at once; checked
  // again on approval, since the receiving shop can change in between.
  const resolved = await resolveTransferDestination({
    organizationId, productId: srcStock.productId, toShopId: toShop.id, toShopName: toShop.name, srcShopStockId: srcStock.id,
  });
  if (!resolved.ok) {
    logger.warn('Transfer refused: same-SKU product in destination can\'t be merged', {
      fromShopId, toShopId: toShop.id, productId: srcStock.productId, reason: resolved.error,
    });
    return fail(400, 'SKU_MERGE_MISMATCH', resolved.error);
  }

  const id = opts.id || uuidv4();
  const now = new Date().toISOString();
  const reserved = await idempotentInsert<TransferRow>('StockTransfer', {
    id,
    organizationId,
    productId: srcStock.productId,
    fromShopId,
    toShopId: toShop.id,
    quantity,
    status: 'pending',
    kind: 'request',
    variants: cells ?? undefined,
    notes: notes?.trim() ? notes.trim() : null,
    initiatedByPortalUserId: portalUserId,
    initiatedAt: now,
  });
  if (!reserved.ok) {
    logger.error('Transfer: failed to record', { error: reserved.error });
    return fail(500, 'INTERNAL_ERROR', 'Failed to record transfer');
  }
  if (!reserved.created) return { ok: true, created: false, transfer: reserved.row };

  // Hold the stock at the source.
  const held = cells
    ? await takeVariantCells(srcStock.id, organizationId, cells)
    : await adjustFlatStock(srcStock.id, -quantity).then((r) => (r.ok ? r : {
        ok: false as const,
        error: r.available >= 0 ? `Insufficient stock. Available: ${r.available}, requested: ${quantity}` : 'Stock changed while sending — try again.',
      }));
  if (!held.ok) {
    await supabaseAdmin.from('StockTransfer').delete().eq('id', id);
    return fail(400, 'INSUFFICIENT_STOCK', held.error);
  }

  const reason = `Transfer out to ${toShop.name} — awaiting approval${noteSuffix(notes)}`;
  await supabaseAdmin.from('StockTransaction').insert((cells ?? [null]).map((cell, i) => ({
    id: cells ? `${id}-out-${i}` : `${id}-out`,
    organizationId,
    shopStockId: srcStock.id,
    portalUserId,
    type: 'subtract',
    quantity: -(cell?.quantity ?? quantity),
    size: cell?.size ?? '',
    color: cell?.color ?? '',
    reason,
    reference: ref(id),
    createdAt: now,
  })));
  await syncProducts(srcStock.productId);

  logger.info('Transfer sent for approval', { transferId: id, fromShopId, toShopId: toShop.id, productId: srcStock.productId, quantity, cells: cells?.length ?? 0 });
  return { ok: true, created: true, transfer: reserved.row };
}

// ── Approve ──────────────────────────────────────────────────────────────────

async function loadTransfer(transferId: string): Promise<TransferRow | null> {
  const { data } = await supabaseAdmin.from('StockTransfer').select('*').eq('id', transferId).maybeSingle();
  return (data as TransferRow | null) ?? null;
}

async function claim(transferId: string, status: 'confirmed' | 'rejected' | 'cancelled', portalUserId: string | null, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabaseAdmin
    .from('StockTransfer')
    .update({ status, resolvedByPortalUserId: portalUserId, resolvedAt: new Date().toISOString(), ...extra })
    .eq('id', transferId)
    .eq('status', 'pending')
    .select('*');
  if (error) return fail(500, 'INTERNAL_ERROR', 'Failed to update transfer');
  if (!data || data.length === 0) return fail(409, 'ALREADY_RESOLVED', 'This transfer was already resolved');
  return { ok: true as const, row: data[0] as TransferRow };
}

const cellsOf = (row: TransferRow): TransferCell[] | null =>
  Array.isArray(row.variants) && row.variants.length > 0 ? (row.variants as TransferCell[]) : null;

async function sourceStockId(row: TransferRow): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('ShopStock')
    .select('id')
    .eq('shopId', row.fromShopId as string)
    .eq('productId', row.productId as string)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Sent before approval existed: the source was held but no "out" row written. */
async function hasOutRow(transferId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('StockTransaction')
    .select('id')
    .eq('reference', ref(transferId))
    .eq('type', 'subtract')
    .limit(1);
  return (data ?? []).length > 0;
}

export async function approveTransfer(opts: {
  transferId: string;
  /** The shop approving — must be the transfer's destination. */
  shopId: string;
  portalUserId: string | null;
}): Promise<{ ok: true; transfer: TransferRow; idempotent?: true } | TransferFailure> {
  const { transferId, shopId, portalUserId } = opts;
  const transfer = await loadTransfer(transferId);
  if (!transfer) return fail(404, 'NOT_FOUND', 'Transfer not found');
  if (transfer.toShopId !== shopId) return fail(403, 'FORBIDDEN', 'Only the receiving shop can approve this transfer');
  if (transfer.status === 'confirmed') return { ok: true, transfer, idempotent: true };
  if (transfer.status !== 'pending') return fail(409, 'ALREADY_RESOLVED', `This transfer was already ${transfer.status}`);

  const organizationId = transfer.organizationId as string;
  const cells = cellsOf(transfer);
  const quantity = Number(transfer.quantity);
  const srcStockId = await sourceStockId(transfer);
  const { data: destShop } = await supabaseAdmin.from('Shop').select('name').eq('id', shopId).maybeSingle();
  const destShopName = (destShop?.name as string | undefined) ?? 'This shop';

  // Resolved before claiming, so a transfer that can't land here stays
  // pending — the receiving shop can still fix its product, or reject.
  const resolved = await resolveTransferDestination({
    organizationId, productId: transfer.productId as string, toShopId: shopId, toShopName: destShopName, srcShopStockId: srcStockId,
  });
  if (!resolved.ok) {
    logger.warn('Transfer approval refused: same-SKU product here can\'t be merged', { transferId, shopId, reason: resolved.error });
    return fail(400, 'SKU_MERGE_MISMATCH', resolved.error);
  }
  const destProductId = resolved.dest.productId;
  let destStockId = resolved.dest.stock?.id ?? null;
  if (!cells && destStockId && (await hasVariantStock(destStockId))) {
    return fail(400, 'SKU_MERGE_MISMATCH', `This product is tracked by size/colour at ${destShopName}, so a plain count can't be added to it. Reject the transfer, or send it by size/colour.`);
  }

  const claimed = await claim(transferId, 'confirmed', portalUserId);
  if (!claimed.ok) return claimed;
  const now = new Date().toISOString();

  if (!destStockId) {
    destStockId = uuidv4();
    // Size/colour stock starts at 0 — the rollup trigger sets the total as the cells land.
    const { error } = await supabaseAdmin.from('ShopStock').insert([{
      id: destStockId, organizationId, shopId, productId: destProductId,
      quantity: cells ? 0 : quantity, lowStockThreshold: 5, createdAt: now, updatedAt: now,
    }]);
    if (error) {
      await supabaseAdmin.from('StockTransfer').update({ status: 'pending', resolvedByPortalUserId: null, resolvedAt: null }).eq('id', transferId);
      logger.error('Transfer approval: failed to create destination stock', { transferId, error: error.message });
      return fail(500, 'INTERNAL_ERROR', 'Failed to add the stock here — try again');
    }
  } else if (!cells) {
    const added = await adjustFlatStock(destStockId, quantity);
    if (!added.ok) {
      await supabaseAdmin.from('StockTransfer').update({ status: 'pending', resolvedByPortalUserId: null, resolvedAt: null }).eq('id', transferId);
      return fail(409, 'STOCK_CHANGED', 'Stock here changed while approving — try again');
    }
  }
  const landed = cells
    ? await addVariantCells({ srcShopStockId: srcStockId, destShopStockId: destStockId, organizationId, cells, carryPricing: !resolved.dest.mergedBySku })
    : null;

  const suffix = noteSuffix(transfer.notes);
  const rows: Record<string, unknown>[] = (landed ?? [null]).map((cell, i) => ({
    id: landed ? `${transferId}-in-${i}` : `${transferId}-in`,
    organizationId, shopStockId: destStockId, portalUserId, type: 'add',
    quantity: cell?.quantity ?? quantity, size: cell?.size ?? '', color: cell?.color ?? '',
    reason: `Transfer in from shop ${transfer.fromShopId}${suffix}`, reference: ref(transferId), createdAt: now,
  }));
  if (srcStockId && !(await hasOutRow(transferId))) {
    rows.push({
      id: `${transferId}-out`, organizationId, shopStockId: srcStockId, portalUserId: transfer.initiatedByPortalUserId,
      type: 'subtract', quantity: -quantity, reason: `Transfer out to ${destShopName}${suffix}`, reference: ref(transferId), createdAt: now,
    });
  }
  await supabaseAdmin.from('StockTransaction').insert(rows);
  await syncProducts(transfer.productId as string, destProductId);

  logger.info('Transfer approved', { transferId, toShopId: shopId, mergedBySku: resolved.dest.mergedBySku });
  return { ok: true, transfer: claimed.row };
}

// ── Reject / cancel ──────────────────────────────────────────────────────────

export async function returnTransfer(opts: {
  transferId: string;
  /** reject: the receiving shop declines. cancel: the sending shop takes it back. */
  action: 'reject' | 'cancel';
  shopId: string;
  portalUserId: string | null;
  reason?: string | null;
}): Promise<{ ok: true; transfer: TransferRow; idempotent?: true } | TransferFailure> {
  const { transferId, action, shopId, portalUserId } = opts;
  const status = action === 'reject' ? 'rejected' : 'cancelled';
  const transfer = await loadTransfer(transferId);
  if (!transfer) return fail(404, 'NOT_FOUND', 'Transfer not found');
  if (action === 'reject' && transfer.toShopId !== shopId) return fail(403, 'FORBIDDEN', 'Only the receiving shop can reject this transfer');
  if (action === 'cancel' && transfer.fromShopId !== shopId) return fail(403, 'FORBIDDEN', 'Only the sending shop can cancel this transfer');
  if (transfer.status === status) return { ok: true, transfer, idempotent: true };
  if (transfer.status !== 'pending') return fail(409, 'ALREADY_RESOLVED', `This transfer was already ${transfer.status}`);

  const claimed = await claim(transferId, status, portalUserId, action === 'reject' ? { rejectionReason: opts.reason?.trim() || null } : {});
  if (!claimed.ok) return claimed;

  const cells = cellsOf(transfer);
  const srcStockId = await sourceStockId(transfer);
  if (cells && srcStockId) await returnVariantCells(srcStockId, transfer.organizationId as string, cells);
  else await returnReservedStock(transfer.productId as string, transfer.fromShopId as string, Number(transfer.quantity));

  // Only transfers sent with approval wrote an "out" row — balance it.
  if (srcStockId && (await hasOutRow(transferId))) {
    const now = new Date().toISOString();
    const why = action === 'reject' ? 'rejected by the receiving shop' : 'cancelled';
    await supabaseAdmin.from('StockTransaction').insert((cells ?? [null]).map((cell, i) => ({
      id: cells ? `${transferId}-return-${i}` : `${transferId}-return`,
      organizationId: transfer.organizationId, shopStockId: srcStockId, portalUserId, type: 'add',
      quantity: cell?.quantity ?? Number(transfer.quantity), size: cell?.size ?? '', color: cell?.color ?? '',
      reason: `Transfer ${why} — stock returned`, reference: ref(transferId), createdAt: now,
    })));
  }
  await syncProducts(transfer.productId as string);

  logger.info(`Transfer ${status}`, { transferId, shopId });
  return { ok: true, transfer: claimed.row };
}
