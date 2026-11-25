import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./activity-tracker', () => ({ trackFromRequest: vi.fn(async () => null) }));

// A tiny chainable stand-in for supabaseAdmin: each table returns what the test set for it,
// and Product updates are recorded.
let product: Record<string, unknown> | null;
// Other shops' copies of the same item (same SKU), as the SKU lookup returns them.
let sameSku: Array<{ id: string; kind: string }>;
let stock: Array<{ quantity: number }>;
const updates: Array<Record<string, unknown>> = [];
const updatedIds: string[][] = [];
const stockQueriedFor: string[][] = [];
let skuPattern: string | null;

function chain(result: () => unknown, onIn?: (ids: string[]) => void) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) c[m] = () => c;
  c.in = (_col: string, ids: string[]) => { onIn?.(ids); return c; };
  // The same-SKU lookup: from here on the chain returns the other copies.
  c.ilike = (_col: string, pattern: string) => { skuPattern = pattern; return chain(() => sameSku); };
  c.maybeSingle = async () => ({ data: result(), error: null });
  c.single = async () => ({ data: result(), error: null });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: result(), error: null });
  return c;
}

vi.mock('./supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'ShopStock') return chain(() => stock, (ids) => stockQueriedFor.push(ids));
      return {
        ...chain(() => (product ? { ...product, archivedAt: updates.at(-1)?.archivedAt ?? null } : null)),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return chain(() => null, (ids) => updatedIds.push(ids));
        },
      };
    },
  },
}));

import { setProductArchived } from './product-archive.server';

describe('setProductArchived', () => {
  beforeEach(() => {
    product = { id: 'p1', name: 'Pleated dress', kind: 'stock', sku: null, deletedAt: null };
    sameSku = [];
    stock = [{ quantity: 0 }, { quantity: 0 }];
    updates.length = 0;
    updatedIds.length = 0;
    stockQueriedFor.length = 0;
    skuPattern = null;
  });

  it("archives every shop's copy of the same SKU and checks all their stock", async () => {
    product = { ...product, sku: 'DR-01' };
    sameSku = [{ id: 'p1', kind: 'stock' }, { id: 'p2', kind: 'stock' }];
    const r = await setProductArchived('org-1', 'p1', true, 'u1');
    expect(r).toMatchObject({ ok: true, productIds: ['p1', 'p2'] });
    expect(stockQueriedFor[0]).toEqual(['p1', 'p2']);
    expect(updatedIds[0]).toEqual(['p1', 'p2']);
  });

  it('matches the SKU literally, so % and _ are not wildcards', async () => {
    product = { ...product, sku: 'A_1%' };
    sameSku = [{ id: 'p1', kind: 'stock' }];
    await setProductArchived('org-1', 'p1', true, 'u1');
    expect(skuPattern).toBe('A\\_1\\%');
  });

  it('archives only itself when it has no SKU', async () => {
    const r = await setProductArchived('org-1', 'p1', true, 'u1');
    expect(r).toMatchObject({ ok: true, productIds: ['p1'] });
    expect(skuPattern).toBeNull();
  });

  it('archives a product that is out of stock in every shop', async () => {
    const r = await setProductArchived('org-1', 'p1', true, 'u1');
    expect(r.ok).toBe(true);
    expect(updates[0].archivedAt).toEqual(expect.any(String));
    expect(updates[0].archivedBy).toBe('u1');
  });

  it('refuses while any shop still holds stock', async () => {
    stock = [{ quantity: 0 }, { quantity: 3 }];
    const r = await setProductArchived('org-1', 'p1', true, 'u1');
    expect(r).toMatchObject({ ok: false, status: 409, code: 'HAS_STOCK' });
    expect(updates).toHaveLength(0);
  });

  it('archives a menu item, which has no stock of its own', async () => {
    product = { ...product, kind: 'menu' };
    stock = [{ quantity: 5 }];
    expect((await setProductArchived('org-1', 'p1', true, 'u1')).ok).toBe(true);
  });

  it('unarchives regardless of stock and clears who archived it', async () => {
    stock = [{ quantity: 4 }];
    const r = await setProductArchived('org-1', 'p1', false, 'u1');
    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual({ archivedAt: null, archivedBy: null });
  });

  it('treats a deleted or foreign product as not found', async () => {
    product = null;
    expect(await setProductArchived('org-1', 'p1', true, 'u1')).toMatchObject({ ok: false, status: 404 });
    product = { id: 'p1', name: 'x', kind: 'stock', deletedAt: '2026-11-01' };
    expect(await setProductArchived('org-1', 'p1', true, 'u1')).toMatchObject({ ok: false, status: 404 });
  });
});
