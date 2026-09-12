import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/mobile-shop-auth', () => ({
  verifyMobileShopAccess: vi.fn(async () => ({
    payload: { userId: 'user-1', organizationId: 'org-1' },
    isAdmin: false,
    portalUserId: 'portal-user-1',
  })),
}));

const syncMock = vi.fn(async (_productId: string) => undefined);
vi.mock('@/lib/supabase-db', () => ({
  syncProductStockFromShopStocks: (...args: [string]) => syncMock(...args),
}));

const state = {
  transferQueue: [] as Array<{ data: unknown; error?: unknown }>,
  shopStockQueue: [] as Array<{ data: unknown; error?: unknown }>,
  transactionQueue: [] as Array<{ data: unknown; error?: unknown }>,
};

function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'insert', 'order', 'limit']) {
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
      if (table === 'ShopStock') return chainable(state.shopStockQueue.shift() ?? { data: null, error: null });
      if (table === 'StockTransaction') return chainable(state.transactionQueue.shift() ?? { data: null, error: null });
      return chainable({ data: null, error: null });
    }),
  },
}));

import { POST } from './route';

const pendingTransfer = {
  id: 'transfer-1', organizationId: 'org-1', productId: 'product-1',
  fromShopId: 'shop-1', toShopId: 'shop-2', quantity: 5, status: 'pending', notes: null,
  initiatedByPortalUserId: 'portal-user-src',
};

function req() {
  return new NextRequest('http://localhost/api/mobile/shops/shop-2/stock/transfer-requests/transfer-1/confirm', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

function ctx() {
  return { params: Promise.resolve({ shopId: 'shop-2', transferId: 'transfer-1' }) };
}

describe('POST .../transfer-requests/[transferId]/confirm', () => {
  beforeEach(() => {
    state.transferQueue = [];
    state.shopStockQueue = [];
    state.transactionQueue = [];
    syncMock.mockClear();
  });

  it('404s when the transfer does not exist', async () => {
    state.transferQueue = [{ data: null }];
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not the destination shop', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, toShopId: 'some-other-shop' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('is idempotent for a retry of an already-confirmed transfer', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, status: 'confirmed' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.idempotent).toBe(true);
  });

  it('409s a transfer that was already rejected/cancelled', async () => {
    state.transferQueue = [{ data: { ...pendingTransfer, status: 'rejected' } }];
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('ALREADY_RESOLVED');
  });

  it('409s when the atomic claim matches no row (lost a race)', async () => {
    state.transferQueue = [{ data: pendingTransfer }];
    state.transferQueue.push({ data: [], error: null }); // claim update matched nothing
    const res = await POST(req(), ctx());
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('ALREADY_RESOLVED');
  });

  it('creates a new destination ShopStock row, writes both audit legs, and confirms', async () => {
    const claimed = { ...pendingTransfer, status: 'confirmed' };
    state.transferQueue = [{ data: pendingTransfer }, { data: [claimed], error: null }];
    state.shopStockQueue = [
      { data: null }, // destStock lookup — no existing row at the destination
      { data: null, error: null }, // the insert() call itself, awaited directly
      { data: { id: 'src-stock-1' } }, // srcStock lookup for the audit-leg reference
    ];
    state.transactionQueue = [{ data: null, error: null }];

    const res = await POST(req(), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('confirmed');
    expect(syncMock).toHaveBeenCalledWith('product-1');
  });

  it('increments an existing destination ShopStock row instead of creating one', async () => {
    const claimed = { ...pendingTransfer, status: 'confirmed' };
    state.transferQueue = [{ data: pendingTransfer }, { data: [claimed], error: null }];
    state.shopStockQueue = [
      { data: { id: 'dest-stock-1', quantity: 4 } }, // existing destStock
      { data: null, error: null }, // the update() call itself, awaited directly
      { data: { id: 'src-stock-1' } }, // srcStock lookup
    ];
    state.transactionQueue = [{ data: null, error: null }];

    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
  });
});
