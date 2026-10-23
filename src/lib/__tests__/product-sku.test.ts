import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const calls: Array<[string, ...unknown[]]> = [];
let tables: Record<string, unknown[]> = {};
vi.mock('../supabase-client', () => {
  const chainFor = (table: string) => {
    const chain = {
      select: (...a: unknown[]) => { calls.push([`${table}.select`, ...a]); return chain; },
      eq: (...a: unknown[]) => { calls.push([`${table}.eq`, ...a]); return chain; },
      neq: (...a: unknown[]) => { calls.push([`${table}.neq`, ...a]); return chain; },
      in: (...a: unknown[]) => { calls.push([`${table}.in`, ...a]); return chain; },
      limit: () => Promise.resolve({ data: tables[table] ?? [] }),
      then: (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [] }),
    };
    return chain;
  };
  return { supabaseAdmin: { from: (table: string) => chainFor(table) } };
});

import { duplicateSkuMessage, findSkuConflict, isSkuUniqueViolation, normalizeSku } from '../product-sku.server';

describe('findSkuConflict', () => {
  it('ignores blank SKUs without querying', async () => {
    calls.length = 0;
    expect(await findSkuConflict('org-1', '  ')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('scopes the lookup to the business, excludes the edited product, and names its shops', async () => {
    calls.length = 0;
    tables = {
      Product: [{ id: 'p2', name: 'Mira fashion short' }],
      ShopStock: [{ shopId: 's2' }, { shopId: 's1' }],
      Shop: [{ name: 'Town Shop' }, { name: 'Main Shop' }],
    };
    expect(await findSkuConflict('org-1', ' T6160-1 ', 'p1')).toEqual({
      id: 'p2', name: 'Mira fashion short', shopNames: ['Main Shop', 'Town Shop'],
    });
    expect(calls).toContainEqual(['Product.eq', 'organizationId', 'org-1']);
    expect(calls).toContainEqual(['Product.eq', 'sku', 'T6160-1']);
    expect(calls).toContainEqual(['Product.neq', 'id', 'p1']);
    expect(calls).toContainEqual(['ShopStock.eq', 'productId', 'p2']);
  });

  it('returns null when no other product has the SKU', async () => {
    tables = { Product: [] };
    expect(await findSkuConflict('org-1', 'FREE-1')).toBeNull();
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
    expect(duplicateSkuMessage('A1', { id: 'p', name: 'X', shopNames: [] })).toBe('Duplicate SKU: "A1" is already used by "X". Please change the SKU and try again.');
    expect(duplicateSkuMessage('')).toBe('Duplicate SKU: This SKU is already used by another product. Please change the SKU and try again.');
  });
});

describe('isSkuUniqueViolation', () => {
  it('matches both the old global and new per-business constraint', () => {
    expect(isSkuUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "Product_sku_key"' })).toBe(true);
    expect(isSkuUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "Product_organizationId_sku_key"' })).toBe(true);
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
