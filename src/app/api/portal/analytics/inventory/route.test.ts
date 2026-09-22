import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let payload: { userId: string; role: string; organizationId: string | null };
vi.mock('@/lib/authorize', () => ({
  requireTenantUser: vi.fn(() => payload),
}));

const canViewCostDataMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/lib/cost-visibility.server', () => ({
  canViewCostData: (...args: unknown[]) => canViewCostDataMock(...args),
}));

let shops: Array<{ id: string; name: string }>;
let stocks: Array<{ id: string; shopId: string; productId: string; quantity: number }>;
let variants: Array<{ shopStockId: string; quantity: number; price?: number | null; costPrice?: number | null }>;
let products: Array<{ id: string; price: number; costPrice?: number | null }>;

function chainable(table: string) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.in = () => q;
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
    const data = { Shop: shops, ShopStock: stocks, ShopStockVariant: variants, Product: products }[table] ?? [];
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return q;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: (table: string) => chainable(table) },
}));

import { GET } from './route';

function request() {
  return new NextRequest('http://localhost/api/portal/analytics/inventory', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/portal/analytics/inventory', () => {
  beforeEach(() => {
    canViewCostDataMock.mockReset().mockResolvedValue(true);
  });

  it('rejects a non-admin', async () => {
    payload = { userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' };
    const res = await GET(request());
    expect(res.status).toBe(403);
  });

  it('values plain stock, variant cells, and skips deleted products', async () => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    shops = [{ id: 'a', name: 'Shop A' }, { id: 'b', name: 'Shop B' }];
    stocks = [
      { id: 's1', shopId: 'a', productId: 'p1', quantity: 10 },   // 10 x 100
      { id: 's2', shopId: 'b', productId: 'p2', quantity: 99 },   // has cells — flat quantity ignored
      { id: 's3', shopId: 'a', productId: 'gone', quantity: 5 },  // deleted product — skipped
    ];
    variants = [
      { shopStockId: 's2', quantity: 2, price: 300, costPrice: 150 },
      { shopStockId: 's2', quantity: 3, price: null, costPrice: null }, // falls back to p2's own 200/120
    ];
    products = [{ id: 'p1', price: 100, costPrice: 60 }, { id: 'p2', price: 200, costPrice: 120 }];

    const res = await GET(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.totalUnits).toBe(15); // 10 + 2 + 3
    expect(json.data.totalRetailValue).toBe(10 * 100 + 2 * 300 + 3 * 200);
    expect(json.data.totalCostValue).toBe(10 * 60 + 2 * 150 + 3 * 120);
    // b (1200) outranks a (1000)
    expect(json.data.shops.map((s: { shopId: string }) => s.shopId)).toEqual(['b', 'a']);
  });

  it('withholds cost value (not an undercount) when any unit has no known cost', async () => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    shops = [{ id: 'a', name: 'Shop A' }, { id: 'b', name: 'Shop B' }];
    stocks = [{ id: 's1', shopId: 'a', productId: 'p1', quantity: 4 }, { id: 's2', shopId: 'b', productId: 'p2', quantity: 1 }];
    variants = [];
    products = [{ id: 'p1', price: 100, costPrice: 60 }, { id: 'p2', price: 50, costPrice: null }];

    const res = await GET(request());
    const json = await res.json();

    expect(json.data.shops.find((s: { shopId: string }) => s.shopId === 'a').costValue).toBe(4 * 60);
    expect(json.data.shops.find((s: { shopId: string }) => s.shopId === 'b').costValue).toBeNull();
    expect(json.data.totalCostValue).toBeNull();
  });

  it('hides cost value entirely for a caller without view_cost_price', async () => {
    canViewCostDataMock.mockResolvedValue(false);
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    shops = [{ id: 'a', name: 'Shop A' }];
    stocks = [{ id: 's1', shopId: 'a', productId: 'p1', quantity: 4 }];
    variants = [];
    products = [{ id: 'p1', price: 100, costPrice: 60 }];

    const res = await GET(request());
    const json = await res.json();

    expect(json.data.totalCostValue).toBeNull();
    expect(json.data.shops[0].costValue).toBeNull();
    expect(json.data.totalRetailValue).toBe(400); // retail value is unaffected by cost visibility
  });

  it('returns an empty result for an org with no active shops', async () => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    shops = [];
    stocks = [];
    variants = [];
    products = [];

    const res = await GET(request());
    const json = await res.json();

    expect(json.data).toEqual({ totalUnits: 0, totalRetailValue: 0, totalCostValue: 0, shops: [] });
  });
});
