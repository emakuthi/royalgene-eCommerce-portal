import { describe, it, expect, vi, beforeEach } from 'vitest';

// applySaleEdit is shared by the portal and app edit routes. The app route
// used to change a sale's quantity without touching stock at all.

vi.mock('server-only', () => ({}));
vi.mock('../logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../supabase-db', () => ({ syncProductStockFromShopStocks: vi.fn(async () => {}) }));
vi.mock('../permissions.server', () => ({ isOwnerLevelCaller: vi.fn(async () => false) }));

const variant = { has: false, decrement: vi.fn(), increment: vi.fn() };
vi.mock('../variant-stock.server', () => ({
  hasVariantStock: vi.fn(async () => variant.has),
  decrementCell: (...a: unknown[]) => variant.decrement(...a),
  incrementCell: (...a: unknown[]) => variant.increment(...a),
}));

const db = {
  shopStock: { id: 'ss-1', quantity: 5 } as Record<string, unknown> | null,
  stockUpdates: [] as Record<string, unknown>[],
  saleUpdates: [] as Record<string, unknown>[],
  txInserts: [] as Record<string, unknown>[],
  saleUpdateFails: false,
};

function chain(table: string) {
  let pendingUpdate: Record<string, unknown> | null = null;
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gte']) obj[m] = vi.fn(() => obj);
  obj.update = vi.fn((u: Record<string, unknown>) => {
    pendingUpdate = u;
    if (table === 'ShopStock') db.stockUpdates.push(u);
    if (table === 'SalesEntry') db.saleUpdates.push(u);
    return obj;
  });
  obj.insert = vi.fn(async (rows: Record<string, unknown>[]) => {
    if (table === 'StockTransaction') db.txInserts.push(...rows);
    return { error: null };
  });
  obj.maybeSingle = vi.fn(async () => (table === 'ShopStock' ? { data: db.shopStock } : { data: null }));
  obj.single = vi.fn(async () =>
    table === 'SalesEntry' && db.saleUpdateFails
      ? { data: null, error: { message: 'boom' } }
      : { data: { id: 'sale-1', ...pendingUpdate }, error: null });
  return obj;
}
vi.mock('../supabase-client', () => ({ supabaseAdmin: { from: vi.fn((t: string) => chain(t)) } }));

import { applySaleEdit } from '../sale-edit.server';

const sale = () => ({
  id: 'sale-1', organizationId: 'org-1', shopId: 'shop-1', productId: 'prod-1',
  quantity: 2, unitPrice: 1000, discountAmount: 200, costPrice: 600,
  size: null, color: null, paymentBreakdown: null,
});

beforeEach(() => {
  db.shopStock = { id: 'ss-1', quantity: 5 };
  db.stockUpdates = []; db.saleUpdates = []; db.txInserts = [];
  db.saleUpdateFails = false;
  variant.has = false;
  variant.decrement.mockReset(); variant.increment.mockReset();
});

describe('applySaleEdit', () => {
  it('takes extra units out of stock when the quantity goes up', async () => {
    const r = await applySaleEdit(sale(), { quantity: 4 }, 'pu-1');
    expect(r.ok).toBe(true);
    expect(db.stockUpdates[0]).toMatchObject({ quantity: 3 });
    expect(db.txInserts[0]).toMatchObject({ quantity: -2, type: 'adjustment', portalUserId: 'pu-1' });
    expect(db.saleUpdates[0]).toMatchObject({ quantity: 4, totalAmount: 4000 - 200 });
  });

  it('puts units back when the quantity goes down', async () => {
    await applySaleEdit(sale(), { quantity: 1 }, 'pu-1');
    expect(db.stockUpdates[0]).toMatchObject({ quantity: 6 });
    expect(db.txInserts[0]).toMatchObject({ quantity: 1 });
  });

  it('rejects an increase the shop cannot cover, without touching the sale', async () => {
    const r = await applySaleEdit(sale(), { quantity: 9 }, 'pu-1');
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(db.saleUpdates).toHaveLength(0);
    expect(db.stockUpdates).toHaveLength(0);
  });

  it('leaves stock alone when only the price or customer changes', async () => {
    const r = await applySaleEdit(sale(), { unitPrice: 1200, customerName: 'Achieng' }, 'pu-1');
    expect(r.ok).toBe(true);
    expect(db.stockUpdates).toHaveLength(0);
    expect(db.saleUpdates[0]).toMatchObject({ totalAmount: 2400 - 200, customerName: 'Achieng' });
  });

  it('uses the variant cell for a size/colour sale', async () => {
    variant.has = true;
    variant.decrement.mockResolvedValue({ ok: true, remaining: 1 });
    await applySaleEdit({ ...sale(), size: 'M', color: 'Red' }, { quantity: 3 }, 'pu-1');
    expect(variant.decrement).toHaveBeenCalledWith('ss-1', 'M', 'Red', 1);
    expect(db.stockUpdates).toHaveLength(0);
  });

  it('puts stock back if the sale update itself fails', async () => {
    db.saleUpdateFails = true;
    const r = await applySaleEdit(sale(), { quantity: 4 }, 'pu-1');
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(db.stockUpdates.map((u) => u.quantity)).toEqual([3, 7]);
  });

  it('validates quantity and price', async () => {
    expect(await applySaleEdit(sale(), { quantity: 0 }, null)).toMatchObject({ ok: false, status: 400 });
    expect(await applySaleEdit(sale(), { quantity: 1.5 }, null)).toMatchObject({ ok: false, status: 400 });
    expect(await applySaleEdit(sale(), { unitPrice: -1 }, null)).toMatchObject({ ok: false, status: 400 });
  });
});
