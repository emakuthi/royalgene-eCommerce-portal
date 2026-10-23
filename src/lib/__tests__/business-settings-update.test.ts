import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../entitlements/__tests__/supabase-mock';
import { categorySlug, getBusinessType } from '../business-types';

const ORG_ID = 'org-1';

let mockTables: MockTables;

vi.mock('server-only', () => ({}));
vi.mock('../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

function starterCategories(type: Parameters<typeof getBusinessType>[0]) {
  return getBusinessType(type).categories.map((name, i) => ({
    id: `cat-${type}-${i}`,
    organizationId: ORG_ID,
    slug: categorySlug(name),
    name,
    sortOrder: i + 1,
    isActive: true,
  }));
}

beforeEach(() => {
  // A fresh Google sign-up: auto-named workspace + shop, default (boutique) starter categories.
  mockTables = {
    Organization: [{ id: ORG_ID, name: "Jane Doe's Workspace", businessType: null, requireAppLock: false }],
    Shop: [{ id: 'shop-1', organizationId: ORG_ID, name: "Jane Doe's Workspace" }],
    ProductCategory: starterCategories('boutique'),
    Product: [],
  };
});

describe('updateBusinessSettings', () => {
  it('renames the workspace and the shop that was auto-named after it', async () => {
    const { updateBusinessSettings } = await import('../business-settings.server');
    const result = await updateBusinessSettings(ORG_ID, { businessName: '  Mama   Njeri Boutique ' });

    expect(result.businessName).toBe('Mama Njeri Boutique');
    expect(mockTables.Organization[0].name).toBe('Mama Njeri Boutique');
    expect(mockTables.Shop[0].name).toBe('Mama Njeri Boutique');
  });

  it('leaves a shop the owner already renamed alone', async () => {
    mockTables.Shop[0].name = 'Town branch';
    const { updateBusinessSettings } = await import('../business-settings.server');
    await updateBusinessSettings(ORG_ID, { businessName: 'Mama Njeri Boutique' });
    expect(mockTables.Shop[0].name).toBe('Town branch');
  });

  it('rejects a too-short name', async () => {
    const { updateBusinessSettings, BusinessSettingsError } = await import('../business-settings.server');
    await expect(updateBusinessSettings(ORG_ID, { businessName: ' x ' })).rejects.toBeInstanceOf(BusinessSettingsError);
    expect(mockTables.Organization[0].name).toBe("Jane Doe's Workspace");
  });

  it('swaps the starter categories when a workspace with no products picks its type', async () => {
    const { updateBusinessSettings } = await import('../business-settings.server');
    await updateBusinessSettings(ORG_ID, { businessType: 'hardware' });

    const hardware = new Set(getBusinessType('hardware').categories.map(categorySlug));
    const active = mockTables.ProductCategory.filter((c) => c.isActive !== false).map((c) => c.slug as string);
    expect(new Set(active)).toEqual(hardware);
    // Hidden, not deleted.
    expect(mockTables.ProductCategory.find((c) => c.slug === 'dresses')?.isActive).toBe(false);
  });

  it('keeps the old categories once the workspace has products', async () => {
    mockTables.Product = [{ id: 'p1', organizationId: ORG_ID, category: 'dresses' }];
    const { updateBusinessSettings } = await import('../business-settings.server');
    await updateBusinessSettings(ORG_ID, { businessType: 'hardware' });
    expect(mockTables.ProductCategory.find((c) => c.slug === 'dresses')?.isActive).toBe(true);
  });

  it('turns the app-lock policy on and reports it back', async () => {
    const { updateBusinessSettings } = await import('../business-settings.server');
    const result = await updateBusinessSettings(ORG_ID, { requireAppLock: true });
    expect(mockTables.Organization[0].requireAppLock).toBe(true);
    expect(result.requireAppLock).toBe(true);
  });

  it('rejects a non-boolean app-lock policy', async () => {
    const { updateBusinessSettings, BusinessSettingsError } = await import('../business-settings.server');
    await expect(updateBusinessSettings(ORG_ID, { requireAppLock: 'yes' })).rejects.toBeInstanceOf(BusinessSettingsError);
  });
});
