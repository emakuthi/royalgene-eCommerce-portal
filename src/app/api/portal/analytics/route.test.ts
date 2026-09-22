import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let payload: { userId: string; role: string; organizationId: string | null };
vi.mock('@/lib/authorize', () => ({
  requireTenantUser: vi.fn(() => payload),
}));

vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertFeatureEnabled: vi.fn(async () => null),
}));

const canViewCostDataMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/lib/cost-visibility.server', () => ({
  canViewCostData: (...args: unknown[]) => canViewCostDataMock(...args),
}));

// Two active shops for org-1, plus the sales rows a query against them should return.
const shops = [{ id: 'shop-a' }, { id: 'shop-b' }];
const salesByShopIds: Record<string, unknown> = {
  'shop-a,shop-b': [
    { id: 's1', productId: 'p1', quantity: 2, totalAmount: 2000, costPrice: 600, createdAt: '2026-09-20T10:00:00Z' },
    { id: 's2', productId: 'p1', quantity: 1, totalAmount: 1000, costPrice: 600, createdAt: '2026-09-21T10:00:00Z' },
  ],
  'shop-a': [
    { id: 's1', productId: 'p1', quantity: 2, totalAmount: 2000, costPrice: 600, createdAt: '2026-09-20T10:00:00Z' },
  ],
};
const products = [{ id: 'p1', name: 'Denim Jacket' }];

function chainable(table: string) {
  const inFilters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => { inFilters[col] = val; return q; };
  q.gte = () => q;
  q.lte = () => q;
  q.in = (col: string, vals: string[]) => { inFilters[col] = vals; return q; };
  q.maybeSingle = async () => {
    if (table === 'Shop') return { data: shops.find(s => s.id === inFilters.id) ?? null };
    return { data: null };
  };
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
    if (table === 'Shop') {
      // org-wide shop listing (no .maybeSingle chained)
      return Promise.resolve({ data: shops, error: null }).then(resolve);
    }
    if (table === 'SalesEntry') {
      const key = (inFilters.shopId as string[] | undefined)?.join(',') ?? '';
      return Promise.resolve({ data: salesByShopIds[key] ?? [], error: null }).then(resolve);
    }
    if (table === 'Product') {
      return Promise.resolve({ data: products, error: null }).then(resolve);
    }
    return Promise.resolve({ data: null, error: null }).then(resolve);
  };
  return q;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: (table: string) => chainable(table) },
}));

import { GET } from './route';

function request(qs = '') {
  return new NextRequest(`http://localhost/api/portal/analytics${qs}`, {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/portal/analytics', () => {
  beforeEach(() => {
    canViewCostDataMock.mockReset().mockResolvedValue(true);
  });

  it('rejects a non-admin with no shopId — they have no "all shops" concept', async () => {
    payload = { userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' };
    const res = await GET(request());
    expect(res.status).toBe(400);
  });

  it('an admin with no shopId gets every active shop in their org aggregated together', async () => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    const res = await GET(request('?range=month'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSales).toBe(3000); // both shops' sales combined
    expect(json.data.summary.totalTransactions).toBe(2);
  });

  it('a single shopId still scopes to just that shop, unchanged', async () => {
    payload = { userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' };
    const res = await GET(request('?shopId=shop-a&range=month'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSales).toBe(2000);
  });

  it('computes profit from SalesEntry.costPrice, not the unwritten ProfitMargin table', async () => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    const res = await GET(request('?range=month'));
    const json = await res.json();

    // (2000 - 600*2) + (1000 - 600*1) = 800 + 400 = 1200
    expect(json.data.summary.totalProfit).toBe(1200);
    expect(json.data.summary.avgMargin).toBeCloseTo((1200 / 3000) * 100, 5);
  });

  it('hides profit entirely for a caller without view_cost_price', async () => {
    canViewCostDataMock.mockResolvedValue(false);
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    const res = await GET(request('?range=month'));
    const json = await res.json();

    expect(json.data.summary.totalProfit).toBeNull();
    expect(json.data.summary.avgMargin).toBeNull();
    expect(json.data.topProducts[0].profit).toBeUndefined();
  });
});
