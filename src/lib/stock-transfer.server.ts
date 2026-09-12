import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import logger from './logger';

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
