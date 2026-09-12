import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/mobile-shop-auth', () => ({
  verifyMobileShopAccess: vi.fn(async () => ({
    payload: { userId: 'user-1', organizationId: 'org-1' },
    isAdmin: false,
    portalUserId: 'portal-user-1',
  })),
}));

vi.mock('@/lib/variant-stock.server', () => ({
  hasVariantStock: vi.fn(async () => false),
}));

vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertFeatureEnabled: vi.fn(async () => null),
}));

type IdempotentInsertResult =
  | { ok: true; created: boolean; row: Record<string, unknown> }
  | { ok: false; error: string; code?: string };

const idempotentInsertMock = vi.fn(async (_table: string, row: Record<string, unknown>): Promise<IdempotentInsertResult> => ({
  ok: true,
  created: true,
  row: { id: row.id, ...row },
}));
vi.mock('@/lib/sync/idempotent-insert.server', () => ({
  idempotentInsert: (...args: [string, Record<string, unknown>]) => idempotentInsertMock(...args),
}));

// Per-table response queues, consumed in the exact order the route's own
// code issues calls — mirrors the pattern used by the variants route test.
const state = {
  shopStockQueue: [] as Array<{ data: unknown; error?: unknown }>,
  shopQueue: [] as Array<{ data: unknown; error?: unknown }>,
  transferQueue: [] as Array<{ data: unknown; error?: unknown }>,
};

function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'insert', 'order', 'limit', 'or']) {
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
      if (table === 'ShopStock') return chainable(state.shopStockQueue.shift() ?? { data: null, error: null });
      if (table === 'Shop') return chainable(state.shopQueue.shift() ?? { data: null, error: null });
      if (table === 'StockTransfer') return chainable(state.transferQueue.shift() ?? { data: [], error: null });
      return chainable({ data: null, error: null });
    }),
  },
}));

import { POST, GET } from './route';

const srcStock = { id: 'stock-src', productId: 'product-1', quantity: 10, lowStockThreshold: 2 };
const srcShop = { organizationId: 'org-1' };
const destShop = { id: 'shop-2', name: 'Downtown Shop', organizationId: 'org-1' };

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/mobile/shops/shop-1/stock/transfer-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function getRequest(qs = '') {
  return new NextRequest(`http://localhost/api/mobile/shops/shop-1/stock/transfer-requests${qs}`, {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
  });
}

function ctx() {
  return { params: Promise.resolve({ shopId: 'shop-1' }) };
}

describe('POST /api/mobile/shops/[shopId]/stock/transfer-requests', () => {
  beforeEach(() => {
    state.shopStockQueue = [];
    state.shopQueue = [];
    state.transferQueue = [];
    idempotentInsertMock.mockClear();
  });

  it('rejects a body missing required fields', async () => {
    const res = await POST(postRequest({ productId: 'p1' }), ctx());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-positive quantity', async () => {
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 0 }), ctx());
    expect(res.status).toBe(400);
  });

  it('rejects transferring to the same shop', async () => {
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-1', quantity: 1 }), ctx());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/must be different/i);
  });

  it('404s when the product has no stock in the source shop', async () => {
    state.shopStockQueue = [{ data: null }, { data: null }]; // primary + fallback lookup, both miss
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 1 }), ctx());
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('NOT_FOUND');
  });

  it('409s a variant-tracked product', async () => {
    const { hasVariantStock } = await import('@/lib/variant-stock.server');
    (hasVariantStock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    state.shopStockQueue = [{ data: srcStock }];
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 1 }), ctx());
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('VARIANT_STOCK');
  });

  it('400s when quantity exceeds what is available', async () => {
    state.shopStockQueue = [{ data: srcStock }];
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 999 }), ctx());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('INSUFFICIENT_STOCK');
  });

  it('403s when the destination shop belongs to a different organization', async () => {
    state.shopStockQueue = [{ data: srcStock }];
    state.shopQueue = [{ data: srcShop }, { data: { ...destShop, organizationId: 'org-2' } }];
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 1 }), ctx());
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('passes through a feature-gate rejection unchanged', async () => {
    const { assertFeatureEnabled } = await import('@/lib/entitlements/enforce.server');
    const gated = new Response(JSON.stringify({ success: false, code: 'FEATURE_DISABLED' }), { status: 402 });
    (assertFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(gated);
    state.shopStockQueue = [{ data: srcStock }];
    state.shopQueue = [{ data: srcShop }];
    const res = await POST(postRequest({ productId: 'p1', toShopId: 'shop-2', quantity: 1 }), ctx());
    expect(res.status).toBe(402);
  });

  it('reserves stock, decrements the source, and returns 201 on a fresh request', async () => {
    state.shopStockQueue = [{ data: srcStock }];
    state.shopQueue = [{ data: srcShop }, { data: destShop }];
    idempotentInsertMock.mockResolvedValueOnce({
      ok: true,
      created: true,
      row: { id: 'transfer-1', status: 'pending', quantity: 3 },
    });
    // the source-decrement update is awaited directly (no .single()) — queue an {error: null}
    state.shopStockQueue.push({ data: null, error: null });

    const res = await POST(postRequest({ productId: 'product-1', toShopId: 'shop-2', quantity: 3 }), ctx());
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.toShopName).toBe('Downtown Shop');
    expect(idempotentInsertMock).toHaveBeenCalledWith('StockTransfer', expect.objectContaining({
      fromShopId: 'shop-1',
      toShopId: 'shop-2',
      productId: 'product-1',
      quantity: 3,
      status: 'pending',
    }));
  });

  it('returns the existing row without decrementing again on an idempotent replay', async () => {
    state.shopStockQueue = [{ data: srcStock }];
    state.shopQueue = [{ data: srcShop }, { data: destShop }];
    idempotentInsertMock.mockResolvedValueOnce({
      ok: true,
      created: false,
      row: { id: 'transfer-1', status: 'pending', quantity: 3 },
    });

    const res = await POST(postRequest({ productId: 'product-1', toShopId: 'shop-2', quantity: 3, id: 'transfer-1' }), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.idempotent).toBe(true);
    // no extra ShopStock call was queued for a decrement, and none should have been consumed
    expect(state.shopStockQueue.length).toBe(0);
  });
});

describe('GET /api/mobile/shops/[shopId]/stock/transfer-requests', () => {
  beforeEach(() => {
    state.shopStockQueue = [];
    state.shopQueue = [];
    state.transferQueue = [];
  });

  it('tags each row with its direction relative to the requesting shop', async () => {
    state.transferQueue = [{
      data: [
        { id: 't-out', fromShopId: 'shop-1', toShopId: 'shop-2', status: 'pending' },
        { id: 't-in', fromShopId: 'shop-2', toShopId: 'shop-1', status: 'pending' },
      ],
      error: null,
    }];

    const res = await GET(getRequest(), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.transfers).toEqual([
      expect.objectContaining({ id: 't-out', direction: 'outgoing' }),
      expect.objectContaining({ id: 't-in', direction: 'incoming' }),
    ]);
  });

  it('propagates a query failure as a 500', async () => {
    state.transferQueue = [{ data: null, error: { message: 'boom' } }];
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(500);
  });
});
