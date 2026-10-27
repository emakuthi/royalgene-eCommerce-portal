import 'server-only';
import { quantityError, roundQuantity } from './business-types';
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
  /** Product.unit — fractions only for measured units (kg, litre ...). */
  unit: string = 'piece',
): { ok: true; cells: TransferCell[]; total: number } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'This product is tracked by size/colour — choose how many of each size/colour to transfer.' };
  }
  const merged = new Map<string, TransferCell>();
  for (const raw of input as Array<Record<string, unknown>>) {
    const size = typeof raw?.size === 'string' ? raw.size.trim() : '';
    const color = typeof raw?.color === 'string' ? raw.color.trim() : '';
    const qty = Number(raw?.quantity);
    const problem = quantityError(qty, unit, { allowZero: true });
    if (problem) return { ok: false, error: problem };
    if (qty === 0) continue;
    const key = `${size}\u0000${color}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += qty;
    else merged.set(key, { size, color, quantity: qty });
  }
  const cells = [...merged.values()];
  if (cells.length === 0) return { ok: false, error: 'Choose at least one unit to transfer.' };
  return { ok: true, cells, total: roundQuantity(cells.reduce((sum, c) => sum + c.quantity, 0)) };
}

/**
 * Take `cells` off a ShopStock's size/colour matrix (a transfer leaving, or
 * being held while it waits for approval). Each cell is decremented with the
 * guarded UPDATE (race-safe against a concurrent sale); if any cell can't
 * cover its share, the cells already taken are put back and nothing sticks.
 * A cell emptied to 0 stays, so its price/cost is still there if the stock
 * comes back or lands at the same product elsewhere.
 */
export async function takeVariantCells(
  srcShopStockId: string,
  organizationId: string | null,
  cells: TransferCell[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const taken: TransferCell[] = [];
  for (const cell of cells) {
    const res = await decrementCell(srcShopStockId, cell.size, cell.color, cell.quantity);
    if (!res.ok) {
      await returnVariantCells(srcShopStockId, organizationId, taken);
      return { ok: false, error: res.error };
    }
    taken.push(cell);
  }
  return { ok: true };
}

/** Put taken cells back where they came from (a rejected or cancelled transfer). */
export async function returnVariantCells(shopStockId: string, organizationId: string | null, cells: TransferCell[]): Promise<void> {
  for (const cell of cells) await incrementCell(shopStockId, organizationId, cell.size, cell.color, cell.quantity);
}

/**
 * Add transferred `cells` to the destination's matrix. Each is added to the
 * existing size/colour that matches ignoring case and spacing ("mint green"
 * joins "Mint green"), kept in the destination's own spelling, so existing
 * cells and their prices stay as they are. Only a new cell is created; it
 * takes the source cell's price/cost when `carryPricing` (same product on
 * both sides), otherwise none, so it sells at the destination product's own
 * price. The rollup trigger keeps ShopStock.quantity in step. Returns where
 * each cell landed, in the order given.
 */
export async function addVariantCells(opts: {
  srcShopStockId: string | null;
  destShopStockId: string;
  organizationId: string | null;
  cells: TransferCell[];
  /** False when the stock lands on a different (same-SKU) product — keep that product's prices. */
  carryPricing: boolean;
}): Promise<TransferCell[]> {
  const { srcShopStockId, destShopStockId, organizationId, cells, carryPricing } = opts;
  const { data: destCells } = await supabaseAdmin
    .from('ShopStockVariant')
    .select('size, color')
    .eq('shopStockId', destShopStockId);
  const existing = new Map<string, { size: string; color: string }>();
  for (const c of (destCells ?? []) as Array<{ size: string; color: string }>) existing.set(looseCellKey(c.size, c.color), c);

  const landed: TransferCell[] = [];
  for (const cell of cells) {
    let pricing: { price: number | null; costPrice: number | null } | undefined;
    if (carryPricing && srcShopStockId) {
      const { data: srcCell } = await supabaseAdmin
        .from('ShopStockVariant')
        .select('price, costPrice')
        .eq('shopStockId', srcShopStockId)
        .eq('size', cell.size)
        .eq('color', cell.color)
        .maybeSingle();
      pricing = {
        price: typeof srcCell?.price === 'number' ? srcCell.price : null,
        costPrice: typeof srcCell?.costPrice === 'number' ? srcCell.costPrice : null,
      };
    }
    const key = looseCellKey(cell.size, cell.color);
    const target = existing.get(key) ?? { size: cell.size, color: cell.color };
    existing.set(key, target); // two incoming spellings of one new cell land together
    await incrementCell(destShopStockId, organizationId, target.size, target.color, cell.quantity, pricing);
    landed.push({ size: target.size, color: target.color, quantity: cell.quantity });
  }
  return landed;
}

/** Size/colour identity ignoring case and spacing: " Mint  Green" matches "mint green". */
export function looseCellKey(size: string, color: string): string {
  const loose = (v: string) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${loose(size)}\u0000${loose(color)}`;
}
