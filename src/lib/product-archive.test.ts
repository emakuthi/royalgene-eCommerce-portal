import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./activity-tracker', () => ({ trackFromRequest: vi.fn(async () => null) }));

// A tiny chainable stand-in for supabaseAdmin: each table returns what the test set for it,
// and Product updates are recorded.
let product: Record<string, unknown> | null;
let stock: Array<{ quantity: number }>;
const updates: Array<Record<string, unknown>> = [];

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in']) c[m] = () => c;
  c.maybeSingle = async () => ({ data: result(), error: null });
  c.single = async () => ({ data: result(), error: null });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: result(), error: null });
  return c;
}

vi.mock('./supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'ShopStock') return chain(() => stock);
      return {
        ...chain(() => product),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return chain(() => ({ id: product?.id, name: product?.name, archivedAt: values.archivedAt }));
        },
      };
    },
  },
}));

import { setProductArchived } from './product-archive.server';

describe('setProductArchived', () => {
  beforeEach(() => {
    product = { id: 'p1', name: 'Pleated dress', kind: 'stock', deletedAt: null };
    stock = [{ quantity: 0 }, { quantity: 0 }];
    updates.length = 0;
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
