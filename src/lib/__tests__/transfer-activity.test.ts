import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const trackFromRequest = vi.fn(async () => 'log-1');
vi.mock('../activity-tracker', () => ({ trackFromRequest: (...a: unknown[]) => trackFromRequest(...(a as [])) }));

const tables: Record<string, unknown> = {
  Shop: [{ id: 'shop-a', name: 'CBD' }, { id: 'shop-b', name: 'Westlands' }],
  Product: { name: 'Mira short pleated' },
  Device: { deviceName: 'Tecno Spark 10', platform: 'android' },
};
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => Promise.resolve({ data: tables[table], error: null });
      q.maybeSingle = () => Promise.resolve({ data: tables[table], error: null });
      return q;
    },
  },
}));

import { trackTransferStep } from '../transfer-activity.server';

describe('trackTransferStep', () => {
  beforeEach(() => trackFromRequest.mockClear());

  it('logs an app transfer as a transfer, with names and the phone', async () => {
    await trackTransferStep({} as NextRequest, { userId: 'u-1', deviceId: 'd-1' }, {
      step: 'send',
      shopId: 'shop-a',
      transfer: { id: 't-1', productId: 'p-1', quantity: 5, fromShopId: 'shop-a', toShopId: 'shop-b', notes: null },
    });
    expect(trackFromRequest).toHaveBeenCalledTimes(1);
    const event = (trackFromRequest.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(event).toMatchObject({ action: 'stock.transfer', category: 'stock', resourceType: 'StockTransfer', resourceId: 't-1', shopId: 'shop-a' });
    expect(event.details).toMatchObject({
      productName: 'Mira short pleated', quantity: 5, fromShopName: 'CBD', toShopName: 'Westlands',
      deviceName: 'Tecno Spark 10', platform: 'android',
    });
  });

  it('names each approval step and keeps a rejection reason', async () => {
    await trackTransferStep({} as NextRequest, { userId: 'u-1' }, {
      step: 'reject', shopId: 'shop-b', reason: 'Wrong size',
      transfer: { id: 't-2', productId: 'p-1', quantity: 1, fromShopId: 'shop-a', toShopId: 'shop-b' },
    });
    const event = (trackFromRequest.mock.calls[0] as unknown[])[2] as { action: string; details: Record<string, unknown> };
    expect(event.action).toBe('stock.transfer.reject');
    expect(event.details.reason).toBe('Wrong size');
    expect(event.details.deviceName).toBeUndefined(); // no device on the token → none invented
  });

  it('never throws when logging fails', async () => {
    trackFromRequest.mockRejectedValueOnce(new Error('db down'));
    await expect(trackTransferStep({} as NextRequest, {}, {
      step: 'cancel', shopId: 'shop-a', transfer: { id: 't-3' },
    })).resolves.toBeUndefined();
  });
});
