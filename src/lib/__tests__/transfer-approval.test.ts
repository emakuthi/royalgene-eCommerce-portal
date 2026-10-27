import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase-db', () => ({ syncProductStockFromShopStocks: vi.fn(async () => undefined) }));
vi.mock('../business-settings.server', () => ({ productUnit: vi.fn(async () => 'piece') }));
vi.mock('../entitlements/enforce.server', () => ({ assertFeatureEnabled: vi.fn(async () => null) }));
vi.mock('../sync/idempotent-insert.server', () => ({ idempotentInsert: vi.fn() }));

const hasVariantStock = vi.fn(async (_id: string) => false);
vi.mock('../variant-stock.server', () => ({ hasVariantStock: (id: string) => hasVariantStock(id) }));

const resolveTransferDestination = vi.fn();
vi.mock('../product-sku.server', () => ({ resolveTransferDestination: (o: unknown) => resolveTransferDestination(o) }));

const addVariantCells = vi.fn(async (o: { cells: unknown[] }) => o.cells);
const returnVariantCells = vi.fn(async () => undefined);
const returnReservedStock = vi.fn(async () => undefined);
vi.mock('../stock-transfer.server', () => ({
  addVariantCells: (o: { cells: unknown[] }) => addVariantCells(o),
  returnVariantCells: (...a: unknown[]) => returnVariantCells(...(a as [])),
  returnReservedStock: (...a: unknown[]) => returnReservedStock(...(a as [])),
  takeVariantCells: vi.fn(),
  normalizeTransferCells: vi.fn(),
}));

// Tiny fake: rows per table; filters are applied to selects/updates.
let db: Record<string, Array<Record<string, unknown>>> = {};
const inserted: Array<{ table: string; rows: unknown }> = [];
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { filters.push([k, v]); return q; };
      q.limit = () => q;
      q.update = (p: Record<string, unknown>) => { patch = p; return q; };
      q.insert = async (r: unknown) => {
        inserted.push({ table, rows: r });
        for (const row of (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>) (db[table] ??= []).push(row);
        return { error: null };
      };
      q.maybeSingle = async () => ({ data: rows()[0] ?? null });
      q.then = (resolve: (v: unknown) => void) => {
        const hit = rows();
        if (patch) for (const r of hit) Object.assign(r, patch);
        resolve({ data: hit, error: null });
      };
      return q;
    },
  },
}));

import { approveTransfer, returnTransfer } from '../transfer-approval.server';

const base = {
  id: 't1', organizationId: 'org', productId: 'p1', fromShopId: 'A', toShopId: 'B',
  quantity: 3, status: 'pending', notes: null, initiatedByPortalUserId: 'pu-a',
};

beforeEach(() => {
  inserted.length = 0;
  vi.clearAllMocks();
  hasVariantStock.mockResolvedValue(false);
  db = {
    StockTransfer: [{ ...base }],
    ShopStock: [{ id: 'ss-a', shopId: 'A', productId: 'p1', quantity: 7 }, { id: 'ss-b', shopId: 'B', productId: 'p1', quantity: 2 }],
    Shop: [{ id: 'B', name: 'Branch B' }],
    StockTransaction: [{ id: 't1-out', reference: 'transfer-request-t1', type: 'subtract' }],
  };
  resolveTransferDestination.mockResolvedValue({ ok: true, dest: { productId: 'p1', stock: { id: 'ss-b' }, mergedBySku: false } });
});

describe('approveTransfer', () => {
  it('only the receiving shop can approve', async () => {
    const r = await approveTransfer({ transferId: 't1', shopId: 'A', portalUserId: 'pu' });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(db.StockTransfer[0].status).toBe('pending');
  });

  it('adds a plain count at the receiving shop and writes the "in" row', async () => {
    const r = await approveTransfer({ transferId: 't1', shopId: 'B', portalUserId: 'pu-b' });
    expect(r.ok).toBe(true);
    expect(db.StockTransfer[0].status).toBe('confirmed');
    expect(db.ShopStock.find((s) => s.id === 'ss-b')!.quantity).toBe(5);
    expect(db.ShopStock.find((s) => s.id === 'ss-a')!.quantity).toBe(7); // already held at send
    const ids = db.StockTransaction.map((t) => t.id);
    expect(ids).toContain('t1-in');
    expect(ids.filter((i) => i === 't1-out')).toHaveLength(1); // not written twice
  });

  it('lands size/colour cells, keeping the receiving product prices when merged by SKU', async () => {
    db.StockTransfer[0].variants = [{ size: 'M', color: 'Blue', quantity: 3 }];
    resolveTransferDestination.mockResolvedValue({ ok: true, dest: { productId: 'p9', stock: { id: 'ss-b' }, mergedBySku: true } });
    const r = await approveTransfer({ transferId: 't1', shopId: 'B', portalUserId: 'pu-b' });
    expect(r.ok).toBe(true);
    expect(addVariantCells).toHaveBeenCalledWith(expect.objectContaining({ srcShopStockId: 'ss-a', destShopStockId: 'ss-b', carryPricing: false }));
    expect(db.StockTransaction.map((t) => t.id)).toContain('t1-in-0');
  });

  it('stays pending when the receiving shop has a product it cannot merge into', async () => {
    resolveTransferDestination.mockResolvedValue({ ok: false, error: 'set its breakdown first' });
    const r = await approveTransfer({ transferId: 't1', shopId: 'B', portalUserId: 'pu-b' });
    expect(r).toMatchObject({ ok: false, code: 'SKU_MERGE_MISMATCH' });
    expect(db.StockTransfer[0].status).toBe('pending');
  });

  it('is idempotent once confirmed', async () => {
    db.StockTransfer[0].status = 'confirmed';
    const r = await approveTransfer({ transferId: 't1', shopId: 'B', portalUserId: 'pu-b' });
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(inserted).toHaveLength(0);
  });
});

describe('returnTransfer', () => {
  it('reject returns the held stock to the source with a "returned" row', async () => {
    const r = await returnTransfer({ transferId: 't1', action: 'reject', shopId: 'B', portalUserId: 'pu-b', reason: 'wrong item' });
    expect(r.ok).toBe(true);
    expect(db.StockTransfer[0]).toMatchObject({ status: 'rejected', rejectionReason: 'wrong item' });
    expect(returnReservedStock).toHaveBeenCalledWith('p1', 'A', 3);
    expect(db.StockTransaction.find((t) => t.id === 't1-return')).toMatchObject({ shopStockId: 'ss-a', quantity: 3, type: 'add' });
  });

  it('cancel puts size/colour cells back and only the sender may cancel', async () => {
    db.StockTransfer[0].variants = [{ size: 'M', color: 'Blue', quantity: 3 }];
    expect(await returnTransfer({ transferId: 't1', action: 'cancel', shopId: 'B', portalUserId: 'pu' })).toMatchObject({ ok: false, status: 403 });
    const r = await returnTransfer({ transferId: 't1', action: 'cancel', shopId: 'A', portalUserId: 'pu-a' });
    expect(r.ok).toBe(true);
    expect(returnVariantCells).toHaveBeenCalledWith('ss-a', 'org', [{ size: 'M', color: 'Blue', quantity: 3 }]);
  });
});
