import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Tiny in-memory stand-in for the PostgREST builder: eq / neq / in filters
// over `db`, resolved by limit / maybeSingle / await.
type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
vi.mock('../supabase-client', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return chain; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return chain; },
      limit: (n: number) => Promise.resolve({ data: rows().slice(0, n) }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows() }),
    };
    return chain;
  };
  return { supabaseAdmin: { from } };
});

let variantStocks = new Set<string>();
vi.mock('../variant-stock.server', () => ({ hasVariantStock: async (id: string) => variantStocks.has(id) }));
vi.mock('../business-settings.server', () => ({
  productUnit: async (id: string) => (db.Product.find((p) => p.id === id)?.unit as string) ?? 'piece',
}));

import {
  buildTransferPreview, duplicateSkuMessage, findSkuConflict, isSkuUniqueViolation, normalizeSku, resolveTransferDestination,
} from '../product-sku.server';

const ORG = 'org-1';
beforeEach(() => {
  variantStocks = new Set();
  db = {
    Product: [
      { id: 'pA', organizationId: ORG, name: 'Mira short (Main)', sku: 'T6160-1', unit: 'piece' },
      { id: 'pB', organizationId: ORG, name: 'Mira short (Town)', sku: 'T6160-1', unit: 'piece' },
      { id: 'pC', organizationId: ORG, name: 'Mira maxi', sku: 'T6160', unit: 'piece' },
      { id: 'pX', organizationId: 'org-2', name: 'Other business', sku: 'T6160', unit: 'piece' },
    ],
    ShopStock: [
      { id: 'ssA-main', productId: 'pA', shopId: 'main', quantity: 5 },
      { id: 'ssB-town', productId: 'pB', shopId: 'town', quantity: 2 },
      { id: 'ssC-main', productId: 'pC', shopId: 'main', quantity: 1 },
    ],
    Shop: [{ id: 'main', name: 'Main Shop' }, { id: 'town', name: 'Town Shop' }, { id: 'mall', name: 'Mall Shop' }],
  };
});

describe('findSkuConflict (unique per shop)', () => {
  it('ignores blank SKUs', async () => {
    expect(await findSkuConflict({ organizationId: ORG, sku: '  ', shopIds: ['main'] })).toBeNull();
  });

  it('allows the same SKU in a different shop of the same business', async () => {
    expect(await findSkuConflict({ organizationId: ORG, sku: 'T6160-1', shopIds: ['mall'] })).toBeNull();
  });

  it('blocks a create when the target shop already has that SKU, naming the shop', async () => {
    expect(await findSkuConflict({ organizationId: ORG, sku: ' T6160-1 ', shopIds: ['main'] }))
      .toEqual({ id: 'pA', name: 'Mira short (Main)', shopNames: ['Main Shop'] });
  });

  it('checks an edit against every shop that stocks the product, excluding itself', async () => {
    // pC (Main) renamed to T6160-1 clashes with pA in Main; pB in Town is fine.
    expect(await findSkuConflict({ organizationId: ORG, sku: 'T6160-1', productId: 'pC' }))
      .toEqual({ id: 'pA', name: 'Mira short (Main)', shopNames: ['Main Shop'] });
    // pA keeping its own SKU isn't a clash with itself.
    expect(await findSkuConflict({ organizationId: ORG, sku: 'T6160-1', productId: 'pA' })).toBeNull();
  });

  it('never matches another business', async () => {
    expect(await findSkuConflict({ organizationId: 'org-3', sku: 'T6160', shopIds: ['main'] })).toBeNull();
  });
});

describe('resolveTransferDestination', () => {
  const base = { organizationId: ORG, toShopName: 'Town Shop', srcShopStockId: 'ssA-main' };

  it('uses the same product when the receiving shop already stocks it', async () => {
    db.ShopStock.push({ id: 'ssA-town', productId: 'pA', shopId: 'town', quantity: 0 });
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r).toEqual({ ok: true, dest: { stock: expect.objectContaining({ id: 'ssA-town' }), productId: 'pA', mergedBySku: false } });
  });

  it("adds to the receiving shop's own product with the same SKU instead of a second listing", async () => {
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r).toEqual({ ok: true, dest: { stock: expect.objectContaining({ id: 'ssB-town', quantity: 2 }), productId: 'pB', mergedBySku: true } });
  });

  it('creates new stock for the source product when no same-SKU product is there', async () => {
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'mall', toShopName: 'Mall Shop' });
    expect(r).toEqual({ ok: true, dest: { stock: null, productId: 'pA', mergedBySku: false } });
  });

  it('refuses a plain count into a size/colour product (no sizes to put it in)', async () => {
    variantStocks.add('ssB-town');
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tracked by size/colour, but this one isn');
  });

  it('refuses size/colour stock into a plain count that has stock, asking for its breakdown first', async () => {
    variantStocks.add('ssA-main');
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('"Mira short (Town)" at Town Shop (SKU "T6160-1") has 2 in stock that isn\'t split by size/colour yet. Set its size/colour breakdown at Town Shop first, then transfer.');
  });

  it('lets size/colour stock land on a plain count that is empty', async () => {
    variantStocks.add('ssA-main');
    db.ShopStock.find((s) => s.id === 'ssB-town')!.quantity = 0;
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r).toEqual({ ok: true, dest: { stock: expect.objectContaining({ id: 'ssB-town' }), productId: 'pB', mergedBySku: true } });
  });

  it('merges when both sides are tracked by size/colour', async () => {
    variantStocks.add('ssA-main');
    variantStocks.add('ssB-town');
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r).toEqual({ ok: true, dest: { stock: expect.objectContaining({ id: 'ssB-town' }), productId: 'pB', mergedBySku: true } });
  });

  it('refuses to merge across different units', async () => {
    db.Product.find((p) => p.id === 'pB')!.unit = 'kg';
    const r = await resolveTransferDestination({ ...base, productId: 'pA', toShopId: 'town' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('different unit');
  });
});

describe('buildTransferPreview', () => {
  const base = { organizationId: ORG, toShopId: 'town', toShopName: 'Town Shop', srcShopStockId: 'ssA-main' };

  it("shows the receiving shop's same-SKU product and flags differing names", async () => {
    db.Product.find((p) => p.id === 'pB')!.price = 3500;
    const p = await buildTransferPreview({ ...base, productId: 'pA' });
    expect(p).toMatchObject({
      outcome: 'merge',
      toShopName: 'Town Shop',
      source: { productId: 'pA', name: 'Mira short (Main)', sku: 'T6160-1' },
      target: { productId: 'pB', name: 'Mira short (Town)', sku: 'T6160-1', quantity: 2, price: 3500 },
      namesDiffer: true,
    });
  });

  it('does not flag names that only differ in case or spacing', async () => {
    db.Product.find((p) => p.id === 'pB')!.name = '  mira   SHORT (main) ';
    expect((await buildTransferPreview({ ...base, productId: 'pA' })).namesDiffer).toBe(false);
  });

  it('says "new" when the receiving shop has nothing with that SKU', async () => {
    expect(await buildTransferPreview({ ...base, toShopId: 'mall', toShopName: 'Mall Shop', productId: 'pA' }))
      .toMatchObject({ outcome: 'new', target: null, namesDiffer: false });
  });

  it('still shows the other product when the merge is blocked', async () => {
    variantStocks.add('ssB-town');
    const p = await buildTransferPreview({ ...base, productId: 'pA' });
    expect(p.outcome).toBe('blocked');
    expect(p.error).toContain('size/colour');
    expect(p.target?.name).toBe('Mira short (Town)');
  });
});

describe('duplicateSkuMessage', () => {
  it('says it is a duplicate, names the product and its shop, and asks for a change', () => {
    expect(duplicateSkuMessage('T6160-1', { id: 'p2', name: 'Mira fashion short', shopNames: ['Main Shop'] }))
      .toBe('Duplicate SKU: "T6160-1" is already used by "Mira fashion short" in Main Shop. Please change the SKU and try again.');
  });

  it('lists a few shops, then summarises the rest', () => {
    expect(duplicateSkuMessage('A1', { id: 'p', name: 'X', shopNames: ['A', 'B'] })).toContain('in A and B.');
    expect(duplicateSkuMessage('A1', { id: 'p', name: 'X', shopNames: ['A', 'B', 'C', 'D', 'E'] })).toContain('in A, B, C and 2 more shops.');
  });

  it('still reads clearly when the product or shops are unknown', () => {
    expect(duplicateSkuMessage('')).toBe('Duplicate SKU: This SKU is already used by another product. Please change the SKU and try again.');
  });
});

describe('isSkuUniqueViolation', () => {
  it('matches the old global constraint only', () => {
    expect(isSkuUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "Product_sku_key"' })).toBe(true);
    expect(isSkuUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "Product_pkey"' })).toBe(false);
    expect(isSkuUniqueViolation(null)).toBe(false);
  });
});

describe('normalizeSku', () => {
  it('stores no-SKU as an empty string (the column is NOT NULL)', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku('  A1 ')).toBe('A1');
  });
});
