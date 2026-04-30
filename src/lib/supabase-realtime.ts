import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';

let initialized = false;

// Shape for realtime payloads: we only need new/old row objects
type RealtimePayload = { new?: Record<string, unknown>; old?: Record<string, unknown> };

export function startRealtimeStockSync() {
  if (initialized) return;
  // Do not start during tests or when realtime is disabled
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.ENABLE_SUPABASE_REALTIME !== 'true') return;

  try {
    // Supabase JS v2 uses channel + postgres_changes; fall back to from().on() when available
    // Subscribe to all inserts/updates/deletes on ShopStock and trigger aggregate sync
    const channelName = 'stock-sync-channel';

    // Try channel API first (v2)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof supabaseAdmin.channel === 'function') {
      try {
        // Subscribe to all Postgres changes for ShopStock
        supabaseAdmin
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          .channel(channelName)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ShopStock' }, (payload: RealtimePayload) => {
            const productId =
              payload?.new?.productid ?? payload?.new?.productId ?? payload?.old?.productid ?? payload?.old?.productId;
            if (productId) {
              // best-effort, log errors
              void syncProductStockFromShopStocks(String(productId)).catch(() => {});
            }
          })
          .subscribe();

        initialized = true;
        console.log('[SupabaseRealtime] Started ShopStock realtime subscription (channel)');
        return;
      } catch (err) {
        console.warn('[SupabaseRealtime] channel subscription failed, falling back to from().on()', err);
      }
    }

    // Fallback to legacy .from().on() API
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof supabaseAdmin.from === 'function' && typeof supabaseAdmin.from('ShopStock').on === 'function') {
      // @ts-expect-error legacy-typing: supabase from().on() isn't typed in this environment
      supabaseAdmin.from('ShopStock').on('*', (payload: RealtimePayload) => {
        const productId =
          payload?.new?.productid ?? payload?.new?.productId ?? payload?.old?.productid ?? payload?.old?.productId;
        if (productId) {
          void syncProductStockFromShopStocks(String(productId)).catch(() => {});
        }
      }).subscribe();

      initialized = true;
      console.log('[SupabaseRealtime] Started ShopStock realtime subscription (legacy)');
      return;
    }

    console.warn('[SupabaseRealtime] No realtime API available on supabaseAdmin client; realtime sync not started');
  } catch (err) {
    console.error('[SupabaseRealtime] Failed to start realtime sync:', err instanceof Error ? err.message : String(err));
  }
}
