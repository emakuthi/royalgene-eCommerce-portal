import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabase-db', () => ({ syncProductStockFromShopStocks: vi.fn(async () => undefined) }));

const hasVariantStockMock = vi.fn(async (..._args: unknown[]) => false);
const incrementCellMock = vi.fn(async (..._args: unknown[]) => undefined);
const decrementCellMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, remaining: 0 }));
vi.mock('../variant-stock.server', () => ({
  hasVariantStock: (...args: unknown[]) => hasVariantStockMock(...args),
  incrementCell: (...args: unknown[]) => incrementCellMock(...args),
  decrementCell: (...args: unknown[]) => decrementCellMock(...args),
}));

// In-memory tables, keyed by id.
let salesEntry: Record<string, Record<string, unknown>> = {};
let shopStock: Record<string, Record<string, unknown>> = {};
let taxInvoiceSalesEntryIds: Set<string> = new Set();
const stockTransactions: Array<Record<string, unknown>> = [];

function chainable(table: string) {
  const filters: Record<string, unknown> = {};
  const inFilters: Record<string, unknown[]> = {};
  let notNullDeletedAt = false;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => { filters[col] = val; return q; };
  q.in = (col: string, vals: unknown[]) => { inFilters[col] = vals; return q; };
  q.update = (patch: Record<string, unknown>) => {
    const applyObj = { ...q };
    applyObj.eq = (col: string, val: unknown) => {
      if (table === 'SalesEntry') {
        const row = salesEntry[val as string];
        if (row) Object.assign(row, patch);
      } else if (table === 'ShopStock') {
        const row = shopStock[val as string];
        if (row) Object.assign(row, patch);
      }
      return Promise.resolve({ error: null });
    };
    return applyObj;
  };
  q.insert = (rows: Array<Record<string, unknown>>) => {
    if (table === 'StockTransaction') stockTransactions.push(...rows);
    return Promise.resolve({ error: null });
  };
  q.delete = () => {
    const delObj: Record<string, unknown> = {};
    delObj.eq = (col: string, val: unknown) => { filters[col] = val; return delObj; };
    delObj.not = (col: string, _op: string, _val: unknown) => { if (col === 'deletedAt') notNullDeletedAt = true; return delObj; };
    delObj.lt = (col: string, val: string) => { filters[`${col}__lt`] = val; return delObj; };
    delObj.select = () => {
      const matched = Object.values(salesEntry).filter((r) =>
        (filters.organizationId === undefined || r.organizationId === filters.organizationId) &&
        (!notNullDeletedAt || r.deletedAt != null) &&
        (filters['deletedAt__lt'] === undefined || (typeof r.deletedAt === 'string' && r.deletedAt < (filters['deletedAt__lt'] as string)))
      );
      for (const r of matched) delete salesEntry[r.id as string];
      return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
    };
    return delObj;
  };
  q.maybeSingle = async () => {
    if (table === 'ShopStock') {
      const row = Object.values(shopStock).find((r) => r.shopId === filters.shopId && r.productId === filters.productId);
      return { data: row ?? null, error: null };
    }
    if (table === 'SalesEntry') {
      const row = salesEntry[filters.id as string];
      if (row && filters.organizationId !== undefined && row.organizationId !== filters.organizationId) return { data: null, error: null };
      return { data: row ?? null, error: null };
    }
    return { data: null, error: null };
  };
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
    if (table === 'SalesEntry') {
      let rows = Object.values(salesEntry);
      if (inFilters.id) rows = rows.filter((r) => (inFilters.id as string[]).includes(r.id as string));
      if (filters.organizationId !== undefined) rows = rows.filter((r) => r.organizationId === filters.organizationId);
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    }
    if (table === 'TaxInvoice') {
      const ids = (inFilters.salesEntryId ?? []) as string[];
      return Promise.resolve({ data: ids.filter((id) => taxInvoiceSalesEntryIds.has(id)).map((id) => ({ salesEntryId: id })), error: null }).then(resolve);
    }
    if (table === 'Shop' || table === 'Product') {
      return Promise.resolve({ data: [], error: null }).then(resolve);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve);
  };
  return q;
}

vi.mock('../supabase-client', () => ({
  supabaseAdmin: { from: (table: string) => chainable(table) },
}));

import { deleteSalesInOrg, restoreSaleFromTrash, purgeExpiredDeletedSales } from '../sale-delete.server';

function makeSale(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, organizationId: 'org-1', shopId: 'shop-1', productId: 'p1', quantity: 2,
    size: null, color: null, totalAmount: 2000, deletedAt: null, ...overrides,
  };
}

describe('deleteSalesInOrg', () => {
  beforeEach(() => {
    salesEntry = {};
    shopStock = { 's1': { id: 's1', shopId: 'shop-1', productId: 'p1', quantity: 5 } };
    taxInvoiceSalesEntryIds = new Set();
    stockTransactions.length = 0;
    hasVariantStockMock.mockReset().mockResolvedValue(false);
    incrementCellMock.mockClear();
    decrementCellMock.mockReset().mockResolvedValue({ ok: true, remaining: 0 });
  });

  it('soft-deletes a plain sale and restocks its quantity', async () => {
    salesEntry['sale-1'] = makeSale('sale-1', { quantity: 3 });
    const outcome = await deleteSalesInOrg('org-1', ['sale-1'], 'pu-1');

    expect(outcome.deleted).toEqual(['sale-1']);
    expect(salesEntry['sale-1'].deletedAt).not.toBeNull();
    expect(shopStock['s1'].quantity).toBe(8); // 5 + 3
    expect(stockTransactions[0]).toMatchObject({ type: 'add', quantity: 3, reason: 'Sale deleted — stock restored' });
  });

  it('restocks the matching variant cell, not the flat quantity, for a variant sale', async () => {
    hasVariantStockMock.mockResolvedValue(true);
    salesEntry['sale-2'] = makeSale('sale-2', { quantity: 2, size: 'M', color: 'Blue' });
    const outcome = await deleteSalesInOrg('org-1', ['sale-2'], 'pu-1');

    expect(outcome.deleted).toEqual(['sale-2']);
    expect(incrementCellMock).toHaveBeenCalledWith('s1', 'org-1', 'M', 'Blue', 2);
    expect(shopStock['s1'].quantity).toBe(5); // flat quantity untouched
  });

  it('reports an id outside the org (or already deleted) as notFound, not failed', async () => {
    salesEntry['sale-3'] = makeSale('sale-3', { organizationId: 'org-2' });
    salesEntry['sale-4'] = makeSale('sale-4', { deletedAt: '2026-01-01T00:00:00Z' });
    const outcome = await deleteSalesInOrg('org-1', ['sale-3', 'sale-4', 'missing'], 'pu-1');

    expect(outcome.deleted).toEqual([]);
    expect(outcome.notFound.sort()).toEqual(['missing', 'sale-3', 'sale-4']);
  });

  it('blocks deleting a sale that already has a tax invoice on file', async () => {
    salesEntry['sale-5'] = makeSale('sale-5');
    taxInvoiceSalesEntryIds.add('sale-5');
    const outcome = await deleteSalesInOrg('org-1', ['sale-5'], 'pu-1');

    expect(outcome.deleted).toEqual([]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].error).toMatch(/tax invoice/i);
    expect(salesEntry['sale-5'].deletedAt).toBeNull(); // untouched
  });
});

describe('restoreSaleFromTrash', () => {
  beforeEach(() => {
    salesEntry = { 'sale-1': makeSale('sale-1', { quantity: 3, deletedAt: '2026-01-01T00:00:00Z' }) };
    shopStock = { 's1': { id: 's1', shopId: 'shop-1', productId: 'p1', quantity: 8 } };
    hasVariantStockMock.mockReset().mockResolvedValue(false);
    decrementCellMock.mockReset().mockResolvedValue({ ok: true, remaining: 0 });
  });

  it('re-applies the sale’s stock effect and clears deletedAt', async () => {
    const result = await restoreSaleFromTrash('org-1', 'sale-1', 'pu-1');

    expect(result).toEqual({ ok: true });
    expect(salesEntry['sale-1'].deletedAt).toBeNull();
    expect(shopStock['s1'].quantity).toBe(5); // 8 - 3
  });

  it('fails without touching anything when there is not enough stock left to take back out', async () => {
    shopStock['s1'].quantity = 1; // less than the sale's 3 units
    const result = await restoreSaleFromTrash('org-1', 'sale-1', 'pu-1');

    expect(result.ok).toBe(false);
    expect(salesEntry['sale-1'].deletedAt).not.toBeNull(); // still deleted
    expect(shopStock['s1'].quantity).toBe(1); // untouched
  });

  it('reports NOT_FOUND for a sale that was never deleted', async () => {
    salesEntry['sale-1'].deletedAt = null;
    const result = await restoreSaleFromTrash('org-1', 'sale-1', 'pu-1');
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('purgeExpiredDeletedSales', () => {
  beforeEach(() => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString(); // 100 days ago
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago
    salesEntry = {
      'expired-1': makeSale('expired-1', { deletedAt: old }),
      'recent-1': makeSale('recent-1', { deletedAt: recent }),
      'active-1': makeSale('active-1', { deletedAt: null }),
    };
  });

  it('only erases a deleted sale past the 90-day retention window', async () => {
    const result = await purgeExpiredDeletedSales('org-1');

    expect(result.purged).toBe(1);
    expect(salesEntry['expired-1']).toBeUndefined();
    expect(salesEntry['recent-1']).toBeDefined();
    expect(salesEntry['active-1']).toBeDefined();
  });
});
