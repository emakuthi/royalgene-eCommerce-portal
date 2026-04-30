import { supabaseAdmin } from './supabase-client';

/**
 * Small internal helper to normalise error objects into strings
 */
function errorToMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    const asObj = err as Record<string, unknown>;
    if (typeof asObj.message === 'string') return asObj.message;
    return JSON.stringify(asObj);
  } catch (e) {
    return String(err);
  }
}

/**
 * Recalculate and persist total stockQuantity for a Product by summing ShopStock.quantity rows.
 * Returns the recalculated total, or null on failure.
 */
export async function recalculateProductStock(productId: string): Promise<number | null> {
  try {
    if (!productId) return null;

    const supaRes = await supabaseAdmin
      .from('ShopStock')
      .select('quantity')
      .eq('productId', productId);

    const stocks = (supaRes as { data?: Array<{ quantity: number }> | null; error?: unknown }).data || [];
    if ((supaRes as { error?: unknown }).error) {
      console.warn('[StockSync] Failed to fetch ShopStock rows for sync:', errorToMessage((supaRes as { error?: unknown }).error));
      return null;
    }

    const total = stocks.reduce((sum: number, row) => sum + (Number(row.quantity) || 0), 0);

    const { error } = await supabaseAdmin
      .from('Product')
      .update({ stockQuantity: total, updatedAt: new Date().toISOString() })
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      console.warn('[StockSync] Failed to update Product stockQuantity during sync:', errorToMessage(error));
      return null;
    }

    console.log('[StockSync] Synced product stockQuantity:', productId, total);
    return total;
  } catch (err) {
    console.error('[StockSync] recalculateProductStock error:', errorToMessage(err));
    return null;
  }
}

/**
 * Recalculate stock quantity for all products.
 * Runs aggregation for every product id currently present in the Product table.
 * Returns a report: { total: number, succeeded: number, failed: number }
 */
export async function syncAllProductStocks(): Promise<{ total: number; succeeded: number; failed: number }> {
  try {
    const { data: products, error } = await supabaseAdmin.from('Product').select('id');
    if (error) {
      console.warn('[StockSync] Failed to fetch products for full sync:', errorToMessage(error));
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const ids = (products || []).map((p: { id?: string }) => p.id).filter(Boolean) as string[];

    let succeeded = 0;
    let failed = 0;

    // Run sequentially to avoid overwhelming DB; if you prefer parallel, switch to Promise.allSettled
    for (const id of ids) {
      const res = await recalculateProductStock(id);
      if (typeof res === 'number') succeeded += 1;
      else failed += 1;
    }

    return { total: ids.length, succeeded, failed };
  } catch (err) {
    console.error('[StockSync] syncAllProductStocks error:', errorToMessage(err));
    return { total: 0, succeeded: 0, failed: 0 };
  }
}
