import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const tables: Record<string, Array<Record<string, unknown>>> = {};
const orFilters: string[] = [];
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'in']) q[m] = () => q;
      q.or = (f: string) => { orFilters.push(f); return q; };
      q.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [] });
      return q;
    },
  },
}));

import { suggestProducts } from '../product-suggest.server';

const product = (id: string, name: string, sku: string | null) =>
  ({ id, name, sku, category: 'dresses', unit: 'pcs', brand: null, price: 1500, sizes: ['M'], colors: [], images: [] });

beforeEach(() => {
  orFilters.length = 0;
  tables.Product = [];
  tables.ShopStock = [];
  tables.Shop = [{ id: 'a', name: 'ELIANA FASHIONS' }, { id: 'b', name: 'Royalgene Collection' }];
});

describe('suggestProducts', () => {
  it('needs at least 2 characters', async () => {
    expect(await suggestProducts({ organizationId: 'o', query: 'm' })).toEqual([]);
  });

  it('shows the same goods once, with every shop that stocks them', async () => {
    tables.Product = [product('p1', 'Mint Dress', 'DRE-1'), product('p2', 'mint dress', 'dre-1')];
    tables.ShopStock = [{ productId: 'p1', shopId: 'a' }, { productId: 'p2', shopId: 'b' }];
    const out = await suggestProducts({ organizationId: 'o', query: 'mint', shopId: 'b' });
    expect(out).toHaveLength(1);
    expect(out[0].shopNames).toEqual(['ELIANA FASHIONS', 'Royalgene Collection']);
    expect(out[0].inThisShop).toBe(true);
  });

  it('puts starts-with matches before contains matches', async () => {
    tables.Product = [product('p1', 'Blue Mint Top', 'T-1'), product('p2', 'Mint Dress', 'D-1')];
    const out = await suggestProducts({ organizationId: 'o', query: 'mint' });
    expect(out.map((s) => s.name)).toEqual(['Mint Dress', 'Blue Mint Top']);
  });

  it('strips characters that would break the search filter', async () => {
    await suggestProducts({ organizationId: 'o', query: 'a,b(c)%' });
    expect(orFilters[0]).toBe('name.ilike.%a b c%,sku.ilike.%a b c%');
  });
});
