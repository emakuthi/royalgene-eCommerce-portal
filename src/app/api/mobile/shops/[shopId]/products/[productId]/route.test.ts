import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Auth is fully bypassed via a direct mock of verifyMobileShopAccess — the
// PUT handler's optimistic-concurrency logic is what's under test here, not
// the auth/access layer (covered elsewhere).
vi.mock('@/lib/mobile-shop-auth', () => ({
  verifyMobileShopAccess: vi.fn(async () => ({
    payload: { userId: 'user-1', organizationId: 'org-1' },
    isAdmin: false,
    portalUserId: 'portal-user-1',
  })),
}));

vi.mock('@/lib/storage-usage.server', () => ({
  deleteUploadedFiles: vi.fn(async () => undefined),
}));

// Same bypass philosophy as verifyMobileShopAccess above — the
// add_inventory/edit_inventory/view_cost_price capability gates added
// alongside optimistic concurrency aren't what this file tests.
vi.mock('@/lib/permissions.server', () => ({
  hasCapability: vi.fn(async () => true),
}));

const state = {
  shopStock: { id: 'stock-1', productId: 'prod-1', quantity: 10, lowStockThreshold: 5 },
  productUpdateRows: [{ id: 'prod-1', version: 3 }] as Array<{ id: string; version: number }>,
  productCurrent: { id: 'prod-1', name: 'Current Name', version: 5 },
  fullShopStock: {
    id: 'stock-1',
    quantity: 10,
    lowStockThreshold: 5,
    Product: {
      id: 'prod-1', name: 'Updated Name', sku: 'sku-1', category: 'cat', description: 'd',
      price: 10, costPrice: 5, images: [], colors: [], sizes: [], version: 3,
    },
  },
  shopStockCalls: 0,
  productCalls: 0,
};

// A minimal stand-in for a supabase-js query builder: every chain method
// (select/eq/update/...) returns the same object, and the object is itself
// thenable so `await queryBuilder` and `await queryBuilder.select(...)`
// both resolve to `resolveValue` — matching how the route code sometimes
// awaits the builder directly (maybeSingle/single) and sometimes awaits a
// trailing `.select()` (the update-then-select version-guard pattern).
function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'insert', 'order', 'limit', 'or', 'is']) {
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
        state.shopStockCalls += 1;
        // 1st call = resolving the ShopStock row for this shopId/productId;
        // 2nd call = the post-update refetch for the response payload.
        return state.shopStockCalls === 1
          ? chainable({ data: state.shopStock, error: null })
          : chainable({ data: state.fullShopStock, error: null });
      }
      if (table === 'Product') {
        state.productCalls += 1;
        // 1st call = the update-then-select version-guard query; 2nd call
        // (conflict path only) = fetching the current row to return to the
        // caller.
        return state.productCalls === 1
          ? chainable({ data: state.productUpdateRows, error: null })
          : chainable({ data: state.productCurrent, error: null });
      }
      return chainable({ data: null, error: null });
    }),
  },
}));

import { PUT } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/mobile/shops/shop-1/products/prod-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return { params: Promise.resolve({ shopId: 'shop-1', productId: 'prod-1' }) };
}

describe('PUT /api/mobile/shops/[shopId]/products/[productId] — optimistic concurrency', () => {
  beforeEach(() => {
    state.shopStockCalls = 0;
    state.productCalls = 0;
    state.productUpdateRows = [{ id: 'prod-1', version: 3 }];
  });

  it('applies the update and returns the new version when the client version still matches', async () => {
    const res = await PUT(makeRequest({ name: 'Updated Name', version: 2 }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.version).toBe(3);
  });

  it('returns 409 VERSION_CONFLICT with the current server row when the version is stale', async () => {
    state.productUpdateRows = []; // simulate: no row matched id+version → someone else updated it first

    const res = await PUT(makeRequest({ name: 'Updated Name', version: 1 }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.code).toBe('VERSION_CONFLICT');
    expect(json.data).toEqual(state.productCurrent);
  });

  it('falls back to unconditional overwrite when the caller omits version (existing web portal behaviour)', async () => {
    const res = await PUT(makeRequest({ name: 'Updated Name' }), makeContext());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // No version was sent, so the guard must not have added a `.eq('version', ...)`
    // filter — asserted indirectly: the single Product call's chain never got
    // an empty-rows result even though state.productUpdateRows was left as-is,
    // and no 409 was returned.
    expect(json.code).toBeUndefined();
  });
});
