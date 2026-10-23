import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const calls: Array<[string, ...unknown[]]> = [];
let rows: Array<{ id: string; name: string }> = [];
vi.mock('../supabase-client', () => {
  const chain = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return chain; },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return chain; },
    neq: (...a: unknown[]) => { calls.push(['neq', ...a]); return chain; },
    limit: () => Promise.resolve({ data: rows }),
  };
  return { supabaseAdmin: { from: () => chain } };
});

import { duplicateSkuMessage, findSkuConflict, isSkuUniqueViolation, normalizeSku } from '../product-sku.server';

describe('findSkuConflict', () => {
  it('ignores blank SKUs without querying', async () => {
    calls.length = 0;
    expect(await findSkuConflict('org-1', '  ')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('scopes the lookup to the business and excludes the product being edited', async () => {
    calls.length = 0;
    rows = [{ id: 'p2', name: 'Mira fashion short' }];
    expect(await findSkuConflict('org-1', ' T6160-1 ', 'p1')).toEqual({ id: 'p2', name: 'Mira fashion short' });
    expect(calls).toContainEqual(['eq', 'organizationId', 'org-1']);
    expect(calls).toContainEqual(['eq', 'sku', 'T6160-1']);
    expect(calls).toContainEqual(['neq', 'id', 'p1']);
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

describe('sku helpers', () => {
  it('stores no-SKU as an empty string (the column is NOT NULL)', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku('  A1 ')).toBe('A1');
  });

  it('names the product that already has the SKU', () => {
    expect(duplicateSkuMessage('T6160-1', 'Mira fashion short')).toContain('"Mira fashion short"');
  });
});
