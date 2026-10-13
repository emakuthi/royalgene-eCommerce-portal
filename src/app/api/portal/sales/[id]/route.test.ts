import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET backs the portal's edit-sale form prefill (/sales/new?saleId=…). It
// didn't exist, so the form silently opened blank for every edit.

const payload = { userId: 'user-1', role: 'shop_manager', organizationId: 'org-1' };
vi.mock('@/lib/authorize', () => ({ requireTenantUser: vi.fn(() => payload) }));
vi.mock('@/lib/activity-tracker', () => ({ trackFromRequest: vi.fn() }));
vi.mock('@/lib/sale-delete.server', () => ({ deleteSalesInOrg: vi.fn() }));

const state = {
  sale: null as Record<string, unknown> | null,
  portalUser: { id: 'pu-1', shopId: 'shop-1', position: 'shop_manager' } as Record<string, unknown> | null,
};

// maybeSingle() → one row; awaiting the chain itself (or .limit()) → a list.
function chain(resolveValue: () => unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'limit']) obj[m] = vi.fn(() => obj);
  obj.maybeSingle = vi.fn(async () => resolveValue());
  obj.then = (onFulfilled: (v: unknown) => unknown) => {
    const one = resolveValue() as { data: unknown };
    return Promise.resolve({ data: one.data ? [one.data] : [], error: null }).then(onFulfilled);
  };
  return obj;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'SalesEntry') return chain(() => ({ data: state.sale, error: null }));
      if (table === 'PortalUser') return chain(() => ({ data: state.portalUser, error: null }));
      if (table === 'ShopStock') return chain(() => ({ data: { id: 'stock-1' }, error: null }));
      return chain(() => ({ data: null, error: null }));
    }),
  },
}));

import { GET } from './route';

const get = () => GET(
  new NextRequest('http://localhost/api/portal/sales/sale-1', { headers: { authorization: 'Bearer t' } }),
  { params: Promise.resolve({ id: 'sale-1' }) },
);

beforeEach(() => {
  payload.role = 'shop_manager';
  state.sale = {
    id: 'sale-1', organizationId: 'org-1', shopId: 'shop-1', productId: 'prod-1',
    quantity: 2, unitPrice: 500, discountAmount: 100, paymentMethod: 'M-Pesa',
  };
  state.portalUser = { id: 'pu-1', shopId: 'shop-1', position: 'shop_manager' };
});

describe('GET /api/portal/sales/[id]', () => {
  it('returns the sale with its shopStockId for the edit form', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data).toMatchObject({ id: 'sale-1', quantity: 2, discountAmount: 100, shopStockId: 'stock-1' });
  });

  it("hides another org's sale", async () => {
    state.sale = { ...state.sale!, organizationId: 'org-2' };
    expect((await get()).status).toBe(404);
  });

  it("forbids a non-admin from another shop's sale", async () => {
    state.portalUser = { id: 'pu-1', shopId: 'shop-2', position: 'shop_manager' };
    expect((await get()).status).toBe(403);
  });

  it("lets an admin read any shop's sale in their org", async () => {
    payload.role = 'admin';
    state.portalUser = { id: 'pu-9', shopId: 'shop-2' };
    expect((await get()).status).toBe(200);
  });

  it('404s a missing or deleted sale', async () => {
    state.sale = null;
    expect((await get()).status).toBe(404);
  });

  it('marks the caller\'s own sale editable', async () => {
    state.sale = { ...state.sale!, portalUserId: 'pu-1' };
    expect((await (await get()).json()).data.canEdit).toBe(true);
  });

  it("marks a teammate's sale read-only for staff", async () => {
    state.sale = { ...state.sale!, portalUserId: 'pu-2' };
    expect((await (await get()).json()).data.canEdit).toBe(false);
  });

  it("lets a shop owner edit a teammate's sale", async () => {
    state.portalUser = { id: 'pu-1', shopId: 'shop-1', position: 'shop_owner' };
    state.sale = { ...state.sale!, portalUserId: 'pu-2' };
    expect((await (await get()).json()).data.canEdit).toBe(true);
  });
});
