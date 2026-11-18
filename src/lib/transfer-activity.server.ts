import 'server-only';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';
import { trackFromRequest } from './activity-tracker';

/**
 * One activity-log row per transfer step — sent, approved, rejected,
 * cancelled — from the app and the portal alike, carrying the product and
 * both shop names as they were at the time (a later rename or delete
 * doesn't blank the log).
 */

export type TransferStep = 'send' | 'confirm' | 'reject' | 'cancel';

const ACTIONS: Record<TransferStep, string> = {
  send: 'stock.transfer',
  confirm: 'stock.transfer.confirm',
  reject: 'stock.transfer.reject',
  cancel: 'stock.transfer.cancel',
};

type Payload = Parameters<typeof trackFromRequest>[1] & { deviceId?: string | null };

export function trackTransferStep(
  request: NextRequest,
  payload: Payload,
  opts: { step: TransferStep; transfer: Record<string, unknown> & { id: string }; shopId: string; reason?: string | null },
): Promise<void> {
  const { step, transfer, shopId } = opts;
  const productId = (transfer.productId as string | undefined) ?? null;
  const fromShopId = (transfer.fromShopId as string | undefined) ?? null;
  const toShopId = (transfer.toShopId as string | undefined) ?? null;

  return (async () => {
    const shopIds = [fromShopId, toShopId].filter((v): v is string => !!v);
    const [shops, product, device] = await Promise.all([
      shopIds.length ? supabaseAdmin.from('Shop').select('id, name').in('id', shopIds) : Promise.resolve({ data: [] }),
      productId ? supabaseAdmin.from('Product').select('name').eq('id', productId).maybeSingle() : Promise.resolve({ data: null }),
      // The app's own events carry the phone's name; a server-side event finds it from the token's device.
      payload?.userId && payload.deviceId
        ? supabaseAdmin.from('Device').select('deviceName, platform').eq('userId', payload.userId).eq('deviceId', payload.deviceId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const dev = device.data as { deviceName?: string | null; platform?: string | null } | null;
    const shopName = new Map(((shops.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));

    await trackFromRequest(request, payload, {
      action: ACTIONS[step],
      category: 'stock',
      resourceType: 'StockTransfer',
      resourceId: transfer.id,
      shopId,
      details: {
        transferId: transfer.id,
        productId,
        productName: (product.data as { name?: string } | null)?.name ?? null,
        quantity: transfer.quantity == null ? null : Number(transfer.quantity),
        variants: Array.isArray(transfer.variants) ? transfer.variants : undefined,
        fromShopId,
        fromShopName: fromShopId ? shopName.get(fromShopId) ?? null : null,
        toShopId,
        toShopName: toShopId ? shopName.get(toShopId) ?? null : null,
        notes: (transfer.notes as string | null | undefined) ?? null,
        reason: opts.reason ?? undefined,
        ...(dev?.deviceName ? { deviceName: dev.deviceName, platform: dev.platform ?? 'android' } : {}),
      },
    });
  })().catch((err) => {
    // The log must never fail the transfer itself.
    logger.warn('Transfer activity log failed', { transferId: transfer.id, step, error: err instanceof Error ? err.message : String(err) });
  });
}
