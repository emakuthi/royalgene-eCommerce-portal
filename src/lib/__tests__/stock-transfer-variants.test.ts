import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabase-db', () => ({ syncProductStockFromShopStocks: vi.fn(async () => undefined) }));

// Source cells' own pricing, looked up by "size|color".
const srcPricing: Record<string, { price: number | null; costPrice: number | null }> = {};
// The destination's existing cells.
let destCells: Array<{ size: string; color: string }> = [];
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: () => {
      const filters: Record<string, string> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, val: string) => { filters[col] = val; return q; };
      q.maybeSingle = async () => ({ data: srcPricing[`${filters.size}|${filters.color}`] ?? null });
      // Listing a ShopStock's cells (the destination's existing sizes/colours).
      q.then = (resolve: (v: unknown) => void) => resolve({ data: filters.shopStockId === 'dest' ? destCells : [] });
      return q;
    },
  },
}));

const decrementCell = vi.fn();
const incrementCell = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../variant-stock.server', () => ({
  decrementCell: (...a: unknown[]) => decrementCell(...a),
  incrementCell: (...a: unknown[]) => incrementCell(...a),
}));

import { moveVariantCells, normalizeTransferCells } from '../stock-transfer.server';

describe('normalizeTransferCells', () => {
  it('trims, merges duplicates, drops zero cells and totals the units', () => {
    const r = normalizeTransferCells([
      { size: ' M ', color: 'Blue', quantity: 2 },
      { size: 'M', color: 'Blue', quantity: 1 },
      { size: 'L', color: 'Blue', quantity: 0 },
    ]);
    expect(r).toEqual({ ok: true, total: 3, cells: [{ size: 'M', color: 'Blue', quantity: 3 }] });
  });

  it.each([
    [undefined],
    [[]],
    [[{ size: 'M', color: '', quantity: 0 }]],
    [[{ size: 'M', color: '', quantity: -1 }]],
    [[{ size: 'M', color: '', quantity: 1.5 }]],
  ])('rejects %j', (input) => {
    expect(normalizeTransferCells(input).ok).toBe(false);
  });
});

describe('moveVariantCells', () => {
  beforeEach(() => {
    decrementCell.mockReset();
    incrementCell.mockClear();
    for (const k of Object.keys(srcPricing)) delete srcPricing[k];
    destCells = [];
  });

  it('takes each cell off the source and adds it to the destination, carrying price/cost over', async () => {
    srcPricing['M|Blue'] = { price: 900, costPrice: 500 };
    decrementCell.mockResolvedValue({ ok: true, remaining: 0 });

    const r = await moveVariantCells({
      srcShopStockId: 'src', destShopStockId: 'dest', organizationId: 'org',
      cells: [{ size: 'M', color: 'Blue', quantity: 2 }, { size: 'L', color: 'Blue', quantity: 1 }],
    });

    expect(r).toEqual({ ok: true, landed: [{ size: 'M', color: 'Blue', quantity: 2 }, { size: 'L', color: 'Blue', quantity: 1 }] });
    expect(decrementCell).toHaveBeenCalledWith('src', 'M', 'Blue', 2);
    expect(incrementCell).toHaveBeenCalledWith('dest', 'org', 'M', 'Blue', 2, { price: 900, costPrice: 500 });
    expect(incrementCell).toHaveBeenCalledWith('dest', 'org', 'L', 'Blue', 1, { price: null, costPrice: null });
  });

  it('puts back what it already took and touches nothing at the destination when a later cell is short', async () => {
    decrementCell
      .mockResolvedValueOnce({ ok: true, remaining: 0 })
      .mockResolvedValueOnce({ ok: false, error: 'Only 1 of L / Blue in stock', available: 1 });

    const r = await moveVariantCells({
      srcShopStockId: 'src', destShopStockId: 'dest', organizationId: 'org',
      cells: [{ size: 'M', color: 'Blue', quantity: 2 }, { size: 'L', color: 'Blue', quantity: 5 }],
    });

    expect(r).toEqual({ ok: false, error: 'Only 1 of L / Blue in stock' });
    // The one restore goes back to the SOURCE; nothing was added to the destination.
    expect(incrementCell).toHaveBeenCalledTimes(1);
    expect(incrementCell).toHaveBeenCalledWith('src', 'org', 'M', 'Blue', 2, { price: null, costPrice: null });
  });

  it("adds to the destination's existing size/colour ignoring case and spacing, in its spelling", async () => {
    destCells = [{ size: '42', color: 'Mint green' }];
    decrementCell.mockResolvedValue({ ok: true, remaining: 0 });

    const r = await moveVariantCells({
      srcShopStockId: 'src', destShopStockId: 'dest', organizationId: 'org',
      cells: [{ size: '42', color: ' mint  GREEN', quantity: 1 }, { size: '44', color: 'Navy', quantity: 2 }],
    });

    expect(r).toEqual({ ok: true, landed: [{ size: '42', color: 'Mint green', quantity: 1 }, { size: '44', color: 'Navy', quantity: 2 }] });
    expect(incrementCell).toHaveBeenCalledWith('dest', 'org', '42', 'Mint green', 1, { price: null, costPrice: null });
    expect(incrementCell).toHaveBeenCalledWith('dest', 'org', '44', 'Navy', 2, { price: null, costPrice: null });
  });

  it("leaves new cells unpriced when landing on another product, so the receiving shop's price applies", async () => {
    srcPricing['M|Blue'] = { price: 6000, costPrice: 1800 };
    decrementCell.mockResolvedValue({ ok: true, remaining: 0 });

    await moveVariantCells({
      srcShopStockId: 'src', destShopStockId: 'dest', organizationId: 'org',
      cells: [{ size: 'M', color: 'Blue', quantity: 1 }], carryPricing: false,
    });

    expect(incrementCell).toHaveBeenCalledWith('dest', 'org', 'M', 'Blue', 1, undefined);
  });
});
