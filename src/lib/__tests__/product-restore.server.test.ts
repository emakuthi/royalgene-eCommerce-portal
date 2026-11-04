import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rows: Record<string, unknown[]> = {};
const rpc = vi.fn();

function query(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.order = () => q;
  q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
  q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; };
  q.not = (c: string) => { filters.push((r) => r[c] != null); return q; };
  q.in = (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; };
  q.then = (res: (v: unknown) => unknown) =>
    res({ data: (rows[table] ?? []).filter((r) => filters.every((f) => f(r as Record<string, unknown>))), error: null });
  return q;
}

vi.mock('../supabase-client', () => ({
  supabaseAdmin: { from: (t: string) => query(t), rpc: (...a: unknown[]) => rpc(...a) },
}));

import { listDeletedProducts, restoreDeletedProduct } from '../product-restore.server';

const org = 'org-1';
const saved = (over: Record<string, unknown>) => ({
  organizationId: org, productId: 'p1', shopId: 's1', stock: { quantity: 12 }, transactions: [{}, {}],
  deletedAt: '2026-11-01T10:00:00Z', restoredAt: null, ...over,
});

beforeEach(() => {
  rpc.mockReset();
  Object.keys(rows).forEach((k) => delete rows[k]);
  rows.Shop = [{ id: 's1', name: 'Main' }];
  rows.User = [{ id: 'u1', name: 'Amina' }];
  rows.activity_logs = [];
  rows.ShopStock = [];
});

describe('listDeletedProducts', () => {
  it('shows who deleted it and what would come back, using the newest copy per shop', async () => {
    rows.Product = [{ id: 'p1', organizationId: org, name: 'Dress', sku: 'D1', deletedAt: '2026-11-02T10:00:00Z' }];
    rows.DeletedShopStock = [saved({ stock: { quantity: 3 } }), saved({ deletedAt: '2026-10-01T10:00:00Z' })];
    rows.activity_logs = [{ organization_id: org, action: 'product.delete', resource_id: 'p1', user_id: 'u1', user_email: 'a@x' }];

    const [p] = await listDeletedProducts(org);
    expect(p.deletedBy).toBe('Amina');
    expect(p.shops).toEqual([{ shopId: 's1', shopName: 'Main', quantity: 3, movements: 2 }]);
  });

  it('lists a product deleted before stock was saved, with nothing to restore', async () => {
    rows.Product = [{ id: 'p1', organizationId: org, name: 'Dress', sku: 'D1', deletedAt: '2026-10-29T10:00:00Z' }];
    rows.DeletedShopStock = [];

    expect((await listDeletedProducts(org))[0].shops).toEqual([]);
  });

  it('lists a live product removed from one shop', async () => {
    rows.Product = [{ id: 'p1', organizationId: org, name: 'Dress', sku: 'D1', deletedAt: null }];
    rows.DeletedShopStock = [saved({})];

    expect((await listDeletedProducts(org)).map((p) => p.id)).toEqual(['p1']);
  });

  it('leaves out a live product that is back in that shop', async () => {
    rows.Product = [{ id: 'p1', organizationId: org, name: 'Dress', sku: 'D1', deletedAt: null }];
    rows.DeletedShopStock = [saved({})];
    rows.ShopStock = [{ productId: 'p1', shopId: 's1' }];

    expect(await listDeletedProducts(org)).toEqual([]);
  });

  it('leaves out copies already restored and other workspaces', async () => {
    rows.Product = [];
    rows.DeletedShopStock = [saved({ restoredAt: '2026-11-03T00:00:00Z' }), saved({ organizationId: 'org-2' })];

    expect(await listDeletedProducts(org)).toEqual([]);
  });
});

describe('restoreDeletedProduct', () => {
  it('scopes the restore to the caller’s workspace', async () => {
    rpc.mockResolvedValue({ data: { ok: true, restored: ['s1'], skipped: [] }, error: null });

    await expect(restoreDeletedProduct(org, 'p1')).resolves.toEqual({ ok: true, restored: ['s1'], skipped: [] });
    expect(rpc).toHaveBeenCalledWith('restore_deleted_product', { p_organization_id: org, p_product_id: 'p1' });
  });

  it('surfaces a database failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(restoreDeletedProduct(org, 'p1')).rejects.toThrow('boom');
  });
});
