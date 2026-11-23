import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../entitlements/__tests__/supabase-mock';

const ORG_ID = 'org-1';
let mockTables: MockTables;

vi.mock('server-only', () => ({}));
vi.mock('../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

beforeEach(() => {
  mockTables = {
    ProductCategory: [
      { id: 'cat-shoes', organizationId: ORG_ID, slug: 'shoes', name: 'Shoes', sortOrder: 1, isActive: true },
      { id: 'cat-bags', organizationId: ORG_ID, slug: 'bags', name: 'Bags', sortOrder: 2, isActive: true },
      { id: 'cat-other', organizationId: ORG_ID, slug: 'other', name: 'Other', sortOrder: 3, isActive: true },
      { id: 'cat-x', organizationId: 'org-2', slug: 'shoes', name: 'Shoes', sortOrder: 1, isActive: true },
    ],
    Product: [
      { id: 'p1', organizationId: ORG_ID, category: 'shoes', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'p2', organizationId: ORG_ID, category: 'shoes', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'p3', organizationId: ORG_ID, category: 'bags', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'p4', organizationId: 'org-2', category: 'shoes', updatedAt: '2026-01-01T00:00:00Z' },
    ],
  };
});

describe('deleteProductCategory', () => {
  it('says how many products are in it before moving anything', async () => {
    const { deleteProductCategory } = await import('../business-settings.server');
    expect(await deleteProductCategory('cat-shoes', ORG_ID)).toEqual({ ok: false, reason: 'in_use', productCount: 2, name: 'Shoes' });
    expect(mockTables.ProductCategory.some((c) => c.id === 'cat-shoes')).toBe(true);
    expect(mockTables.Product.filter((p) => p.category === 'shoes')).toHaveLength(3);
  });

  it('once agreed, moves its products to Other (touching updatedAt for sync) and removes it', async () => {
    const { deleteProductCategory } = await import('../business-settings.server');
    expect(await deleteProductCategory('cat-shoes', ORG_ID, { moveProducts: true })).toEqual({ ok: true, movedProducts: 2 });
    expect(mockTables.ProductCategory.map((c) => c.id)).toEqual(['cat-bags', 'cat-other', 'cat-x']);
    const p1 = mockTables.Product.find((p) => p.id === 'p1')!;
    expect(p1.category).toBe('other');
    expect(p1.updatedAt).not.toBe('2026-01-01T00:00:00Z');
    // Another workspace's products in a same-named category are untouched.
    expect(mockTables.Product.find((p) => p.id === 'p4')!.category).toBe('shoes');
    expect(mockTables.Product.find((p) => p.id === 'p3')!.category).toBe('bags');
  });

  it('deletes an empty category straight away', async () => {
    mockTables.Product = [];
    const { deleteProductCategory } = await import('../business-settings.server');
    expect(await deleteProductCategory('cat-bags', ORG_ID)).toEqual({ ok: true, movedProducts: 0 });
  });

  it('keeps "Other", and ignores another workspace\'s category', async () => {
    const { deleteProductCategory } = await import('../business-settings.server');
    expect(await deleteProductCategory('cat-other', ORG_ID, { moveProducts: true })).toEqual({ ok: false, reason: 'fallback' });
    expect(await deleteProductCategory('cat-x', ORG_ID, { moveProducts: true })).toEqual({ ok: false, reason: 'not_found' });
    expect(mockTables.ProductCategory).toHaveLength(4);
  });
});
