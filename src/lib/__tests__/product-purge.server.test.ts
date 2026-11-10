import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rows: Record<string, Record<string, unknown>[]> = {};
let deleteError: { message: string } | null = null;

function query(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  let mode: 'select' | 'count' | 'delete' | 'update' = 'select';
  let values: Record<string, unknown> = {};
  let single = false;
  const q: Record<string, unknown> = {};
  q.select = (_cols?: string, opts?: { count?: string }) => { if (opts?.count) mode = 'count'; return q; };
  q.delete = () => { mode = 'delete'; return q; };
  q.update = (v: Record<string, unknown>) => { mode = 'update'; values = v; return q; };
  q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
  q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; };
  q.or = (expr: string) => {
    const parts = expr.split(',').map((p) => p.split('.eq.'));
    filters.push((r) => parts.some(([c, v]) => r[c] === v));
    return q;
  };
  q.maybeSingle = () => { single = true; return q; };
  q.then = (res: (v: unknown) => unknown) => {
    const all = rows[table] ?? [];
    const hit = all.filter((r) => filters.every((f) => f(r)));
    if (mode === 'count') return res({ count: hit.length, error: null });
    if (mode === 'delete') {
      if (table === 'Product' && deleteError) return res({ error: deleteError });
      rows[table] = all.filter((r) => !hit.includes(r));
      return res({ error: null });
    }
    if (mode === 'update') { hit.forEach((r) => Object.assign(r, values)); return res({ error: null }); }
    return res({ data: single ? hit[0] ?? null : hit, error: null });
  };
  return q;
}

vi.mock('../supabase-client', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));

import { purgeDeletedProduct } from '../product-restore.server';

const org = 'org-1';

beforeEach(() => {
  deleteError = null;
  Object.keys(rows).forEach((k) => delete rows[k]);
  rows.Product = [{ id: 'p1', organizationId: org, name: 'Dress', deletedAt: '2026-11-02T10:00:00Z', purgedAt: null }];
  rows.DeletedShopStock = [{ organizationId: org, productId: 'p1', shopId: 's1', restoredAt: null }];
  rows.SalesEntry = [];
  rows.OrderItem = [];
  rows.StockTransfer = [];
  rows.RecipeItem = [];
});

describe('purgeDeletedProduct', () => {
  it('erases a deleted product with no history, and its saved stock', async () => {
    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: true, erased: true });
    expect(rows.Product).toHaveLength(0);
    expect(rows.DeletedShopStock).toHaveLength(0);
  });

  it('keeps a product with sales, marked purged, so the sales keep its name', async () => {
    rows.SalesEntry = [{ id: 'sale-1', productId: 'p1' }];

    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: true, erased: false });
    expect(rows.Product[0]).toMatchObject({ name: 'Dress' });
    expect(rows.Product[0].purgedAt).toBeTruthy();
    expect(rows.SalesEntry).toHaveLength(1);
    expect(rows.DeletedShopStock).toHaveLength(0);
  });

  it('keeps a product used as a recipe ingredient', async () => {
    rows.RecipeItem = [{ id: 'r1', productId: 'dish', ingredientProductId: 'p1' }];

    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: true, erased: false });
    expect(rows.RecipeItem).toHaveLength(1);
  });

  it('falls back to marking it purged when something else blocks the delete', async () => {
    deleteError = { message: 'violates foreign key constraint' };

    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: true, erased: false });
    expect(rows.Product[0].purgedAt).toBeTruthy();
  });

  it('only drops the saved copy for a live product removed from one shop', async () => {
    rows.Product[0].deletedAt = null;

    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: true, erased: false });
    expect(rows.Product[0].purgedAt).toBeNull();
    expect(rows.DeletedShopStock).toHaveLength(0);
  });

  it('refuses another workspace\'s product, or one already purged', async () => {
    expect(await purgeDeletedProduct('org-2', 'p1')).toEqual({ ok: false, code: 'NOT_FOUND' });
    rows.Product[0].purgedAt = '2026-11-10T10:00:00Z';
    expect(await purgeDeletedProduct(org, 'p1')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(rows.DeletedShopStock).toHaveLength(1);
  });
});
