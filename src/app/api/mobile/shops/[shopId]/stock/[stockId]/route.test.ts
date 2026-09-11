import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth.server', () => ({
  verifyToken: vi.fn(() => ({ userId: 'user-1' })),
}));

vi.mock('@/lib/variant-stock.server', () => ({
  hasVariantStock: vi.fn(async () => false),
}));

const state = {
  portalUser: { id: 'portal-user-1', userId: 'user-1', shopId: 'shop-1' },
  currentStock: { id: 'stock-1', shopId: 'shop-1', organizationId: 'org-1', quantity: 10 },
  updatedRows: [{ id: 'stock-1', quantity: 25, version: 3 }] as Array<Record<string, unknown>>,
  conflictCurrent: { id: 'stock-1', quantity: 12, version: 5 },
  shopStockCalls: 0,
};

// Same generic thenable supabase-builder stand-in as the Product route
// test: every chain method returns the same object, which is itself
// awaitable, so it works whether the code does `await x.maybeSingle()`,
// `await x.single()`, or `await x` / `await x.select()` directly.
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
      if (table === 'PortalUser') {
        return chainable({ data: state.portalUser, error: null });
      }
      if (table === 'ShopStock') {
        state.shopStockCalls += 1;
        // 1st call = the pre-update lookup; 2nd = the guarded UPDATE...select();
        // 3rd (conflict path only) = re-fetching the current row.
        if (state.shopStockCalls === 1) return chainable({ data: state.currentStock, error: null });
        if (state.shopStockCalls === 2) return chainable({ data: state.updatedRows, error: null });
        return chainable({ data: state.conflictCurrent, error: null });
      }
      if (table === 'StockTransaction') {
        return chainable({ data: null, error: null });
      }
      return chainable({ data: null, error: null });
    }),
  },
}));

import { PUT } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/mobile/shops/shop-1/stock/stock-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ shopId: 'shop-1', stockId: 'stock-1' }) };
}

describe('PUT /api/mobile/shops/[shopId]/stock/[stockId] — optimistic concurrency', () => {
  beforeEach(() => {
    state.shopStockCalls = 0;
    state.updatedRows = [{ id: 'stock-1', quantity: 25, version: 3 }];
  });

  it('applies the update and returns the new version when the client version still matches', async () => {
    const res = await PUT(makeRequest({ quantity: 25, version: 2 }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.version).toBe(3);
  });

  it('returns 409 VERSION_CONFLICT with the current server row when the version is stale', async () => {
    state.updatedRows = []; // no row matched id+version → someone else updated it first

    const res = await PUT(makeRequest({ quantity: 25, version: 1 }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.code).toBe('VERSION_CONFLICT');
    expect(json.data).toEqual(state.conflictCurrent);
  });

  it('falls back to unconditional overwrite when the caller omits version (existing behaviour)', async () => {
    const res = await PUT(makeRequest({ quantity: 25 }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.code).toBeUndefined();
  });
});
