import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-db', () => ({ syncProductStockFromShopStocks: vi.fn(async () => {}) }));

// Tiny in-memory stand-in for the supabase query builder: select/eq/in/
// maybeSingle/update/insert/delete over plain arrays.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'delete' } = { kind: 'select' };
  const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === 'update') { for (const r of rows()) Object.assign(r, (op as { patch: Row }).patch); return { data: null, error: null }; }
    if (op.kind === 'delete') { tables[table] = (tables[table] ?? []).filter((r) => !filters.every((f) => f(r))); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const b = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (patch: Row) => { op = { kind: 'update', patch }; return b; },
    delete: () => { op = { kind: 'delete' }; return b; },
    insert: async (rs: Row[]) => { (tables[table] ??= []).push(...rs); return { error: null }; },
    then: (res: (v: unknown) => void) => res(run()),
  };
  return b;
}
vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));

import { moveIngredients, RecipeError, setRecipe } from '../recipes.server';

const ORG = 'org-1';
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.Product = [
    { id: 'burger', organizationId: ORG, name: 'Burger', kind: 'menu', unit: 'plate' },
    { id: 'bun', organizationId: ORG, name: 'Bun', kind: 'stock', unit: 'piece' },
    { id: 'beef', organizationId: ORG, name: 'Beef', kind: 'stock', unit: 'kg' },
    { id: 'chips', organizationId: ORG, name: 'Chips', kind: 'menu', unit: 'plate' },
  ];
  tables.ShopStock = [
    { id: 'ss-bun', shopId: 'shop-1', productId: 'bun', quantity: 10 },
    { id: 'ss-beef', shopId: 'shop-1', productId: 'beef', quantity: 1 },
  ];
});

describe('setRecipe', () => {
  it('saves ingredients and merges duplicates', async () => {
    await setRecipe(ORG, 'burger', [
      { ingredientProductId: 'bun', quantity: 1 },
      { ingredientProductId: 'beef', quantity: 0.15 },
      { ingredientProductId: 'beef', quantity: 0.05 },
    ]);
    expect(tables.RecipeItem.map((r) => [r.ingredientProductId, r.quantity])).toEqual([['bun', 1], ['beef', 0.2]]);
  });

  it('rejects a menu item as an ingredient, a fraction of a piece, and itself', async () => {
    await expect(setRecipe(ORG, 'burger', [{ ingredientProductId: 'chips', quantity: 1 }])).rejects.toBeInstanceOf(RecipeError);
    await expect(setRecipe(ORG, 'burger', [{ ingredientProductId: 'bun', quantity: 0.5 }])).rejects.toThrow(/whole number/);
    await expect(setRecipe(ORG, 'burger', [{ ingredientProductId: 'burger', quantity: 1 }])).rejects.toBeInstanceOf(RecipeError);
  });
});

describe('moveIngredients', () => {
  beforeEach(async () => {
    await setRecipe(ORG, 'burger', [{ ingredientProductId: 'bun', quantity: 1 }, { ingredientProductId: 'beef', quantity: 0.15 }]);
  });

  it('uses up each ingredient for the quantity sold and records it', async () => {
    await moveIngredients({ organizationId: ORG, shopId: 'shop-1', productId: 'burger', menuQuantity: 2, portalUserId: 'pu', reference: 'sale-1', reason: 'Used in sale' });
    expect(tables.ShopStock.find((s) => s.id === 'ss-bun')!.quantity).toBe(8);
    expect(tables.ShopStock.find((s) => s.id === 'ss-beef')!.quantity).toBe(0.7);
    expect(tables.StockTransaction).toHaveLength(2);
  });

  it('stops at zero instead of blocking, and a negative quantity puts ingredients back', async () => {
    await moveIngredients({ organizationId: ORG, shopId: 'shop-1', productId: 'burger', menuQuantity: 12, portalUserId: null, reference: 'sale-2', reason: 'Used in sale' });
    expect(tables.ShopStock.find((s) => s.id === 'ss-bun')!.quantity).toBe(0);
    await moveIngredients({ organizationId: ORG, shopId: 'shop-1', productId: 'burger', menuQuantity: -3, portalUserId: null, reference: 'sale-delete-2', reason: 'Sale deleted' });
    expect(tables.ShopStock.find((s) => s.id === 'ss-bun')!.quantity).toBe(3);
    expect(tables.ShopStock.find((s) => s.id === 'ss-beef')!.quantity).toBe(0.45);
  });

  it('skips an ingredient the shop does not stock', async () => {
    await moveIngredients({ organizationId: ORG, shopId: 'shop-2', productId: 'burger', menuQuantity: 1, portalUserId: null, reference: 'x', reason: 'Used in sale' });
    expect(tables.StockTransaction ?? []).toHaveLength(0);
  });
});
