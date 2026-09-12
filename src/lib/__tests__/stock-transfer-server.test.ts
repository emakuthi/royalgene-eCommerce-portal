import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncMock = vi.fn(async (_productId: string) => undefined);
vi.mock('../supabase-db', () => ({
  syncProductStockFromShopStocks: (...args: [string]) => syncMock(...args),
}));

const state = { shopStockQueue: [] as Array<{ data: unknown; error?: unknown }> };

function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update']) {
    obj[m] = vi.fn(() => obj);
  }
  obj.maybeSingle = vi.fn(async () => resolveValue);
  (obj as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).then(resolve, reject);
  return obj;
}

vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'ShopStock') return chainable(state.shopStockQueue.shift() ?? { data: null, error: null });
      return chainable({ data: null, error: null });
    }),
  },
}));

import { returnReservedStock } from '../stock-transfer.server';

describe('returnReservedStock', () => {
  beforeEach(() => {
    state.shopStockQueue = [];
    syncMock.mockClear();
  });

  it('adds the quantity back to the source ShopStock row and re-syncs the product total', async () => {
    state.shopStockQueue = [
      { data: { id: 'stock-1', quantity: 2 } }, // lookup
      { data: null, error: null },              // update() itself, awaited directly
    ];

    await returnReservedStock('product-1', 'shop-1', 5);

    expect(syncMock).toHaveBeenCalledWith('product-1');
  });

  it('logs and does nothing further when the source ShopStock row is gone', async () => {
    state.shopStockQueue = [{ data: null }];

    await expect(returnReservedStock('product-1', 'shop-1', 5)).resolves.toBeUndefined();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('does not throw if the post-return sync fails', async () => {
    state.shopStockQueue = [
      { data: { id: 'stock-1', quantity: 2 } },
      { data: null, error: null },
    ];
    syncMock.mockRejectedValueOnce(new Error('sync boom'));

    await expect(returnReservedStock('product-1', 'shop-1', 5)).resolves.toBeUndefined();
  });
});
