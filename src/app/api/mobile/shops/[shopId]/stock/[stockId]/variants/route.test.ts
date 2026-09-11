import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/mobile-shop-auth', () => ({
  verifyMobileShopAccess: vi.fn(async () => ({
    payload: { userId: 'user-1', organizationId: 'org-1' },
    isAdmin: false,
    portalUserId: 'portal-user-1',
  })),
}));

const emptyMatrix = { hasVariants: false, total: 0, cells: [], sizes: [], colors: [], sizeTotals: {}, colorTotals: {} };
const replacedMatrix = {
  hasVariants: true,
  total: 5,
  cells: [{ id: 'cell-1', shopStockId: 'stock-1', size: 'M', color: 'Red', quantity: 5 }],
  sizes: ['M'],
  colors: ['Red'],
  sizeTotals: { M: 5 },
  colorTotals: { Red: 5 },
};

// The variants route's own write logic (delete/upsert cells, roll up to
// ShopStock.quantity) lives in variant-stock.server and isn't re-tested
// here — that's the unit tested elsewhere. This test is only for the
// version-guard the route adds around it, so getVariantMatrix/
// setVariantMatrix are mocked directly.
vi.mock('@/lib/variant-stock.server', () => ({
  getVariantMatrix: vi.fn(async () => emptyMatrix),
  setVariantMatrix: vi.fn(async () => replacedMatrix),
}));

const stock = { id: 'stock-1', shopId: 'shop-1', organizationId: 'org-1', quantity: 0, version: 2 };
const claimedRows = [{ id: 'stock-1', version: 3 }];
const conflictCurrent = { id: 'stock-1', version: 6, quantity: 8 };
const freshStock = { version: 4 };

// Each `from('ShopStock')` call shifts the next queued response — set per
// test to exactly the sequence that scenario's code path produces, since
// the number of ShopStock calls differs (the version-claim step only runs
// when the request sends a `version`).
const state = { shopStockQueue: [] as Array<{ data: unknown; error: unknown }> };

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
      if (table === 'ShopStock') {
        const next = state.shopStockQueue.shift();
        return chainable(next ?? { data: null, error: null });
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
  return new NextRequest('http://localhost/api/mobile/shops/shop-1/stock/stock-1/variants', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ shopId: 'shop-1', stockId: 'stock-1' }) };
}

// route.ts's inferred (unannotated) PUT return type includes `undefined` —
// a pre-existing quirk of loadStock()'s `'error' in res` narrowing, not
// something this test is exercising — so assert it away once here instead
// of at every call site.
async function put(body: Record<string, unknown>): Promise<Response> {
  const res = await PUT(makeRequest(body), makeContext());
  if (!res) throw new Error('PUT returned no response');
  return res;
}

describe('PUT /api/mobile/shops/[shopId]/stock/[stockId]/variants — optimistic concurrency', () => {
  beforeEach(() => {
    state.shopStockQueue = [];
  });

  it('replaces the matrix and returns the fresh version when the client version still matches', async () => {
    state.shopStockQueue = [
      { data: stock, error: null },        // loadStock()
      { data: claimedRows, error: null },  // version-claim touch-update matched
      { data: freshStock, error: null },   // post-replace fresh-version re-fetch
    ];

    const res = await put({ cells: [{ size: 'M', color: 'Red', quantity: 5 }], version: 2 });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.version).toBe(4);
    expect(json.data.total).toBe(5);
  });

  it('returns 409 VERSION_CONFLICT with the current matrix when the version is stale', async () => {
    state.shopStockQueue = [
      { data: stock, error: null },   // loadStock()
      { data: [], error: null },      // claim-touch matched nothing → someone else changed it first
      { data: conflictCurrent, error: null }, // conflict re-fetch
    ];

    const res = await put({ cells: [{ size: 'M', color: 'Red', quantity: 5 }], version: 1 });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.code).toBe('VERSION_CONFLICT');
    expect(json.data.version).toBe(6);
  });

  it('falls back to unconditional replace when the caller omits version (existing behaviour)', async () => {
    state.shopStockQueue = [
      { data: stock, error: null },      // loadStock()
      { data: freshStock, error: null }, // post-replace fresh-version re-fetch — no claim step in between
    ];

    const res = await put({ cells: [{ size: 'M', color: 'Red', quantity: 5 }] });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.code).toBeUndefined();
  });
});
