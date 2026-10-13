import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const orgUpdates: unknown[] = [];
const categoryRows: Record<string, { slug: string; isActive: boolean }> = {};
const upserted: unknown[] = [];
vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from(table: string) {
      const chain = {
        _slug: '',
        select: () => chain,
        eq: (col: string, v: string) => { if (col === 'slug') chain._slug = v; return chain; },
        order: () => chain,
        maybeSingle: async () => ({ data: table === 'ProductCategory' ? categoryRows[chain._slug] ?? null : null, error: null }),
        then: (res: (v: unknown) => void) => res({ data: [], error: null }),
        update: (row: unknown) => { orgUpdates.push(row); return { eq: async () => ({ error: null }) }; },
        upsert: async (rows: unknown[]) => { upserted.push(...rows); return { error: null }; },
      };
      return chain;
    },
  },
}));

import { BUSINESS_TYPES, categorySlug, getBusinessType, isMeasuredUnit, normalizeUnit, quantityError, roundQuantity } from '../business-types';
import { BusinessSettingsError, resolveCategorySlug, updateBusinessSettings } from '../business-settings.server';

describe('categorySlug', () => {
  it('matches the slugs products already use', () => {
    expect(categorySlug('Dresses')).toBe('dresses');
    expect(categorySlug('  Shoes ')).toBe('shoes');
    expect(categorySlug('Over the counter')).toBe('over-the-counter');
    expect(categorySlug('Vitamins & supplements')).toBe('vitamins-and-supplements');
    expect(categorySlug('!!!')).toBe('');
  });

  it('gives every starter category a distinct, non-empty slug', () => {
    for (const t of BUSINESS_TYPES) {
      const slugs = t.categories.map(categorySlug);
      expect(slugs.every(Boolean)).toBe(true);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});

describe('business types', () => {
  it('falls back to boutique for unknown or missing types', () => {
    expect(getBusinessType(undefined).id).toBe('boutique');
    expect(getBusinessType('casino').id).toBe('boutique');
    expect(getBusinessType('restaurant').option1Label).toBe('Portion');
  });

  it('normalises units', () => {
    expect(normalizeUnit(' KG ')).toBe('kg');
    expect(normalizeUnit('')).toBe('piece');
    expect(normalizeUnit(undefined)).toBe('piece');
  });
});

describe('resolveCategorySlug', () => {
  it('keeps a known category and adds an unknown one instead of filing it elsewhere', async () => {
    categoryRows.shoes = { slug: 'shoes', isActive: true };
    expect(await resolveCategorySlug('org-1', 'Shoes')).toBe('shoes');
    expect(upserted).toHaveLength(0);

    expect(await resolveCategorySlug('org-1', 'Bags')).toBe('bags');
    expect(upserted).toContainEqual(expect.objectContaining({ organizationId: 'org-1', slug: 'bags', name: 'Bags' }));
  });

  it('files an empty category under "other"', async () => {
    expect(await resolveCategorySlug('org-1', '')).toBe('other');
  });
});

describe('updateBusinessSettings', () => {
  it('rejects an unknown type and over-long option names before touching the database', async () => {
    await expect(updateBusinessSettings('org-1', { businessType: 'casino' })).rejects.toBeInstanceOf(BusinessSettingsError);
    await expect(updateBusinessSettings('org-1', { option1Label: 'x'.repeat(40) })).rejects.toBeInstanceOf(BusinessSettingsError);
    await expect(updateBusinessSettings('org-1', {})).rejects.toBeInstanceOf(BusinessSettingsError);
    expect(orgUpdates).toHaveLength(0);
  });

  it("switching type applies that type's option names", async () => {
    await updateBusinessSettings('org-1', { businessType: 'hardware' });
    expect(orgUpdates[0]).toMatchObject({ businessType: 'hardware', option1Label: 'Size', option2Label: '' });
  });

  it('lets the owner rename or switch off an option', async () => {
    orgUpdates.length = 0;
    await updateBusinessSettings('org-1', { option1Label: ' Flavour ', option2Label: '' });
    expect(orgUpdates[0]).toMatchObject({ option1Label: 'Flavour', option2Label: '' });
  });
});

describe('quantityError', () => {
  it('allows fractions only for measured units', () => {
    expect(quantityError(0.5, 'kg')).toBeNull();
    expect(quantityError(1.25, 'litre')).toBeNull();
    expect(quantityError(0.5, 'piece')).toMatch(/whole number/);
    expect(quantityError(2.5, undefined)).toMatch(/whole number/);
    expect(quantityError(3, 'piece')).toBeNull();
  });

  it('rejects zero, negatives and junk unless zero is allowed', () => {
    expect(quantityError(0, 'piece')).toMatch(/more than 0/);
    expect(quantityError(0, 'piece', { allowZero: true })).toBeNull();
    expect(quantityError(-1, 'kg', { allowZero: true })).toMatch(/negative/);
    expect(quantityError('abc', 'kg')).toMatch(/number/);
  });

  it('keeps to three decimals', () => {
    expect(quantityError(0.1234, 'kg')).toMatch(/3 decimal/);
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(isMeasuredUnit(' KG ')).toBe(true);
    expect(isMeasuredUnit('pack')).toBe(false);
  });
});
