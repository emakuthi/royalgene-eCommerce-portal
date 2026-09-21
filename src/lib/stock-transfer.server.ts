import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import logger from './logger';
import { decrementCell, incrementCell } from './variant-stock.server';

/**
 * Shared by reject (destination declines) and cancel (source takes it back
 * before the destination acts) — both end a still-pending transfer by
 * giving the reserved quantity back to the source shop. No StockTransaction
 * rows: nothing net moved (the source's own reserve-on-initiate decrement
 * is simply undone), same as [SalesStockAdjuster.reverse] on the Android
 * side never writing an audit row for a reversal either.
 */
export async function returnReservedStock(
  productId: string,
  fromShopId: string,
  quantity: number,
): Promise<void> {
  const { data: srcStock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity')
    .eq('shopId', fromShopId)
    .eq('productId', productId)
    .maybeSingle();

  if (!srcStock) {
    // Extremely unlikely (the row existed at initiate time and ShopStock
    // rows are never hard-deleted) — log rather than silently drop the
    // quantity on the floor.
    logger.error('returnReservedStock: source ShopStock row is gone', { productId, fromShopId, quantity });
    return;
  }

  await supabaseAdmin
    .from('ShopStock')
    .update({ quantity: (srcStock.quantity as number) + quantity, updatedAt: new Date().toISOString() })
    .eq('id', srcStock.id);

  try {
    await syncProductStockFromShopStocks(productId);
  } catch (syncErr) {
    logger.warn('returnReservedStock: failed to sync product stockQuantity', {
      error: syncErr instanceof Error ? syncErr.message : String(syncErr), productId,
    });
  }
}

// ── Size × colour transfers ────────────────────────────────────────────────

export interface TransferCell {
  size: string;
  color: string;
  quantity: number;
}

/**
 * Validate + tidy the `variants` array a client sends for a size/colour
 * product: trims size/colour, drops zero-quantity cells, merges duplicates,
 * and rejects anything that isn't a positive whole number. Returns the total
 * so the caller doesn't have to trust a separately-sent `quantity`.
 */
export function normalizeTransferCells(
  input: unknown,
): { ok: true; cells: TransferCell[]; total: number } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'This product is tracked by size/colour — choose how many of each size/colour to transfer.' };
  }
  const merged = new Map<string, TransferCell>();
  for (const raw of input as Array<Record<string, unknown>>) {
    const size = typeof raw?.size === 'string' ? raw.size.trim() : '';
    const color = typeof raw?.color === 'string' ? raw.color.trim() : '';
    const qty = Number(raw?.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      return { ok: false, error: 'Each size/colour quantity must be a whole number.' };
    }
    if (qty === 0) continue;
    const key = `${size}\u0000${color}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += qty;
    else merged.set(key, { size, color, quantity: qty });
  }
  const cells = [...merged.values()];
  if (cells.length === 0) return { ok: false, error: 'Choose at least one unit to transfer.' };
  return { ok: true, cells, total: cells.reduce((sum, c) => sum + c.quantity, 0) };
}

/**
 * Move `cells` from one ShopStock's size/colour matrix to another's. Each
 * source cell is decremented with the guarded UPDATE (race-safe against a
 * concurrent sale); if any cell can't cover its share, the cells already
 * taken are put back and the whole move reports failure — a half-applied
 * transfer never sticks. The destination cell inherits the source cell's own
 * price/cost when it has to be created. The rollup trigger keeps both
 * ShopStock.quantity totals in step.
 */
export async function moveVariantCells(opts: {
  srcShopStockId: string;
  destShopStockId: string;
  organizationId: string | null;
  cells: TransferCell[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { srcShopStockId, destShopStockId, organizationId, cells } = opts;
  const taken: Array<{ cell: TransferCell; price: number | null; costPrice: number | null }> = [];

  for (const cell of cells) {
    const { data: srcCell } = await supabaseAdmin
      .from('ShopStockVariant')
      .select('price, costPrice')
      .eq('shopStockId', srcShopStockId)
      .eq('size', cell.size)
      .eq('color', cell.color)
      .maybeSingle();

    const res = await decrementCell(srcShopStockId, cell.size, cell.color, cell.quantity);
    if (!res.ok) {
      for (const done of taken) {
        await incrementCell(srcShopStockId, organizationId, done.cell.size, done.cell.color, done.cell.quantity, {
          price: done.price, costPrice: done.costPrice,
        });
      }
      return { ok: false, error: res.error };
    }
    taken.push({
      cell,
      price: typeof srcCell?.price === 'number' ? srcCell.price : null,
      costPrice: typeof srcCell?.costPrice === 'number' ? srcCell.costPrice : null,
    });
  }

  for (const { cell, price, costPrice } of taken) {
    await incrementCell(destShopStockId, organizationId, cell.size, cell.color, cell.quantity, { price, costPrice });
  }
  return { ok: true };
}
