import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/mobile-shop-auth', () => ({
  verifyMobileShopAccess: vi.fn(async () => ({
    payload: { userId: 'user-1', organizationId: 'org-1' },
    isAdmin: false,
    portalUserId: 'portal-user-1',
  })),
}));

const returnReservedStockMock = vi.fn(async (_productId: string, _fromShopId: string, _quantity: number) => undefined);
vi.mock('@/lib/stock-transfer.server', () => ({
  returnReservedStock: (...args: [string, string, number]) => returnReservedStockMock(...args),
}));

const state = { transferQueue: [] as Array<{ data: unknown; error?: unknown }> };

function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'insert']) {
    obj[m] = vi.fn(() => obj);
  }
  obj.maybeSingle = vi.fn(async () => resolveValue);
  obj.single = vi.fn(async () => resolveValue);
  (obj as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).then(resolve, reject);
  return obj;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'StockTransfer') return chainable(state.transferQueue.shift() ?? { data: null, error: null });
      return chainable({ data: null, error: null });
    }),
  },
}));

import { POST } from './route';

const pendingTransfer = {
  id: 'transfer-1', productId: 'product-1', fromShopId: 'shop-1', toShopId: 'shop-2', quantity: 5, status: 'pending',
};

function req() {
  return new NextRequest('http://localhost/api/mobile/shops/shop-1/stock/transfer-requests/transfer-1/cancel', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

function ctx() {
  return { params: Promise.resolve({ shopId: 'shop-1', transferId: 'transfer-1' }) };
}

describe('POST .../transfer-requests/[transferId]/cancel', () => {
  beforeEach(() => {
    state.transferQueue = [];
    returnReservedStockMock.mockClear();
  });

  it('404s when the transfer does not exist', async () => {
    state.transferQueue = [{ data: null }];
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not the source shop', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, fromShopId: 'other-shop' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('is idempotent for a retry of an already-cancelled transfer', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, status: 'cancelled' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.idempotent).toBe(true);
    expect(returnReservedStockMock).not.toHaveBeenCalled();
  });

  it('409s a transfer the destination already resolved', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, status: 'confirmed' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('ALREADY_RESOLVED');
  });

  it('409s when the atomic claim loses a race (destination just resolved it)', async () => {
    state.transferQueue = [{ data: pendingTransfer }, { data: [], error: null }];
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(returnReservedStockMock).not.toHaveBeenCalled();
  });

  it('claims the transfer and returns the reserved stock to the source shop', async () => {
    const claimed = { ...pendingTransfer, status: 'cancelled' };
    state.transferQueue = [{ data: pendingTransfer }, { data: [claimed], error: null }];

    const res = await POST(req(), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('cancelled');
    expect(returnReservedStockMock).toHaveBeenCalledWith('product-1', 'shop-1', 5);
  });
});
