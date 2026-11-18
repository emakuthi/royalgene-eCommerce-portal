import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { roundQuantity } from './business-types';

export type StockAdjustResult =
  | { ok: true; before: number; after: number }
  | { ok: false; available: number };

/**
 * Adds `delta` to a plain ShopStock count as a compare-and-set, so two
 * changes landing together (a sale and a transfer, two phones selling the
 * last few) can't overwrite each other. A read-then-write of
 * `quantity - sold` put back whatever the other change took or held.
 *
 * `belowZero`: 'refuse' fails when there isn't enough (sending a transfer);
 * 'clamp' stops at 0 (a sale already recorded); 'allow' lets it go negative.
 * `available` is -1 when the row kept changing under every attempt.
 */
export async function adjustShopStock(
  shopStockId: string,
  delta: number,
  belowZero: 'refuse' | 'clamp' | 'allow' = 'refuse',
): Promise<StockAdjustResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await supabaseAdmin.from('ShopStock').select('quantity').eq('id', shopStockId).maybeSingle();
    if (!row) return { ok: false, available: 0 };
    const current = Number(row.quantity) || 0;
    let next = roundQuantity(current + delta);
    if (next < 0) {
      if (belowZero === 'refuse') return { ok: false, available: current };
      if (belowZero === 'clamp') next = 0;
    }
    const { data: updated } = await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: next, updatedAt: new Date().toISOString() })
      .eq('id', shopStockId)
      .eq('quantity', row.quantity)
      .select('id');
    if (updated && updated.length > 0) return { ok: true, before: current, after: next };
  }
  return { ok: false, available: -1 };
}
