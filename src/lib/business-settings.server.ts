import 'server-only';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';
import {
  categorySlug,
  categoryNameFromSlug,
  getBusinessType,
  isBusinessTypeId,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  normalizeUnit,
  PRODUCT_UNITS,
  type BusinessTypeId,
} from './business-types';

// A workspace's business setup: its type, what its two product options are
// called, and its product categories (migration 20261014_01).

export interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface BusinessSettings {
  businessType: BusinessTypeId;
  /** Name of product option 1 (stored in the `size` columns); '' = off. */
  option1Label: string;
  /** Name of product option 2 (stored in the `color` columns); '' = off. */
  option2Label: string;
  categories: ProductCategory[];
  units: readonly string[];
}

export class BusinessSettingsError extends Error {}

function mapCategory(row: Record<string, unknown>): ProductCategory {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    sortOrder: Number(row.sortOrder) || 0,
    isActive: row.isActive !== false,
  };
}

export async function listProductCategories(organizationId: string, opts: { activeOnly?: boolean } = {}): Promise<ProductCategory[]> {
  let q = supabaseAdmin.from('ProductCategory').select('*').eq('organizationId', organizationId);
  if (opts.activeOnly) q = q.eq('isActive', true);
  const { data, error } = await q.order('sortOrder').order('name');
  if (error) {
    logger.warn('[business] listProductCategories failed', { organizationId, error: error.message });
    return [];
  }
  return (data ?? []).map(mapCategory);
}

export async function getBusinessSettings(organizationId: string): Promise<BusinessSettings> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('businessType, option1Label, option2Label')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) logger.warn('[business] getBusinessSettings failed', { organizationId, error: error.message });
  const row = (data ?? {}) as { businessType?: string; option1Label?: string | null; option2Label?: string | null };
  const type = getBusinessType(row.businessType);
  let categories = await listProductCategories(organizationId);
  if (categories.length === 0 && !error) {
    // A workspace created without a type (e.g. Google sign-up) gets its starter list on first look.
    await seedCategoriesForType(organizationId, type.id);
    categories = await listProductCategories(organizationId);
  }
  return {
    businessType: type.id,
    option1Label: row.option1Label ?? type.option1Label,
    option2Label: row.option2Label ?? type.option2Label,
    categories,
    units: PRODUCT_UNITS,
  };
}

/** Adds the type's starter categories the workspace doesn't already have. Never removes any. */
export async function seedCategoriesForType(organizationId: string, businessType: BusinessTypeId): Promise<void> {
  const rows = getBusinessType(businessType).categories.map((name, i) => ({
    organizationId,
    slug: categorySlug(name),
    name,
    sortOrder: i + 1,
  }));
  const { error } = await supabaseAdmin
    .from('ProductCategory')
    .upsert(rows, { onConflict: 'organizationId,slug', ignoreDuplicates: true });
  if (error) logger.warn('[business] seedCategoriesForType failed', { organizationId, businessType, error: error.message });
}

function cleanOptionLabel(raw: unknown, field: string): string {
  if (typeof raw !== 'string') throw new BusinessSettingsError(`${field} must be a string`);
  const v = raw.trim();
  if (v.length > MAX_OPTION_LABEL_LENGTH) throw new BusinessSettingsError(`${field} must be ${MAX_OPTION_LABEL_LENGTH} characters or fewer`);
  return v;
}

export interface BusinessSettingsPatch {
  businessType?: unknown;
  option1Label?: unknown;
  option2Label?: unknown;
}

/**
 * Owner: change the business type and/or option names. Switching type applies
 * that type's option names (unless given explicitly) and adds its starter
 * categories; existing categories and products are left alone.
 */
export async function updateBusinessSettings(organizationId: string, patch: BusinessSettingsPatch): Promise<BusinessSettings> {
  const update: Record<string, unknown> = {};
  let newType: BusinessTypeId | null = null;

  if (patch.businessType !== undefined) {
    if (!isBusinessTypeId(patch.businessType)) throw new BusinessSettingsError('Unknown business type');
    newType = patch.businessType;
    const def = getBusinessType(newType);
    update.businessType = newType;
    update.option1Label = def.option1Label;
    update.option2Label = def.option2Label;
  }
  if (patch.option1Label !== undefined) update.option1Label = cleanOptionLabel(patch.option1Label, 'option1Label');
  if (patch.option2Label !== undefined) update.option2Label = cleanOptionLabel(patch.option2Label, 'option2Label');
  if (Object.keys(update).length === 0) throw new BusinessSettingsError('Nothing to update');

  update.updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from('Organization').update(update).eq('id', organizationId);
  if (error) throw new Error(error.message);
  if (newType) await seedCategoriesForType(organizationId, newType);
  return getBusinessSettings(organizationId);
}

function cleanCategoryName(raw: unknown): string {
  if (typeof raw !== 'string') throw new BusinessSettingsError('Category name is required');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw new BusinessSettingsError('Category name is required');
  if (name.length > MAX_CATEGORY_NAME_LENGTH) throw new BusinessSettingsError(`Category name must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer`);
  if (!categorySlug(name)) throw new BusinessSettingsError('Category name needs at least one letter or number');
  return name;
}

/** Adds a category, or re-activates the existing one with the same slug. */
export async function createProductCategory(organizationId: string, rawName: unknown): Promise<ProductCategory> {
  const name = cleanCategoryName(rawName);
  const slug = categorySlug(name);
  const { data: existing } = await supabaseAdmin
    .from('ProductCategory').select('*').eq('organizationId', organizationId).eq('slug', slug).maybeSingle();
  if (existing) {
    if ((existing as { isActive?: boolean }).isActive !== false) throw new BusinessSettingsError('That category already exists');
    const { data, error } = await supabaseAdmin
      .from('ProductCategory')
      .update({ isActive: true, name, updatedAt: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id)
      .select('*').single();
    if (error) throw new Error(error.message);
    return mapCategory(data);
  }
  const { data: last } = await supabaseAdmin
    .from('ProductCategory').select('sortOrder').eq('organizationId', organizationId)
    .order('sortOrder', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseAdmin
    .from('ProductCategory')
    .insert([{ organizationId, slug, name, sortOrder: (Number((last as { sortOrder?: number } | null)?.sortOrder) || 0) + 1 }])
    .select('*').single();
  if (error) throw new Error(error.message);
  return mapCategory(data);
}

/**
 * Rename, hide or reorder a category. Renaming changes only the display name:
 * the slug stays, so products already in it keep pointing at it.
 */
export async function updateProductCategory(
  id: string,
  organizationId: string,
  patch: { name?: unknown; isActive?: unknown; sortOrder?: unknown },
): Promise<ProductCategory | null> {
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) update.name = cleanCategoryName(patch.name);
  if (patch.isActive !== undefined) {
    if (typeof patch.isActive !== 'boolean') throw new BusinessSettingsError('isActive must be true or false');
    update.isActive = patch.isActive;
  }
  if (patch.sortOrder !== undefined) {
    const n = Number(patch.sortOrder);
    if (!Number.isInteger(n)) throw new BusinessSettingsError('sortOrder must be a whole number');
    update.sortOrder = n;
  }
  const { data, error } = await supabaseAdmin
    .from('ProductCategory')
    .update(update)
    .eq('id', id)
    .eq('organizationId', organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCategory(data) : null;
}

/**
 * The slug to store on Product.category for whatever a client sent — a slug
 * ("over-the-counter") or a display name ("Over the counter"). An unknown
 * category is created on the spot, so an offline-created product from the app
 * never fails or gets filed somewhere else. Empty → "other".
 */
export async function resolveCategorySlug(organizationId: string, raw: unknown): Promise<string> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const slug = categorySlug(text) || 'other';
  try {
    const { data } = await supabaseAdmin
      .from('ProductCategory').select('slug, isActive').eq('organizationId', organizationId).eq('slug', slug).maybeSingle();
    if (data) return slug;
    const name = text && text.length <= MAX_CATEGORY_NAME_LENGTH && text !== slug ? text : categoryNameFromSlug(slug);
    const { error } = await supabaseAdmin
      .from('ProductCategory')
      .upsert([{ organizationId, slug, name, sortOrder: 100 }], { onConflict: 'organizationId,slug', ignoreDuplicates: true });
    if (error) logger.warn('[business] auto-create category failed', { organizationId, slug, error: error.message });
  } catch (err) {
    logger.warn('[business] resolveCategorySlug failed', { organizationId, error: err instanceof Error ? err.message : String(err) });
  }
  return slug;
}

/**
 * For a Product update: turns a sent category into the workspace's slug
 * (adding it if new) and cleans a sent unit. Leaves absent fields absent.
 */
export async function normalizeProductUpdate(organizationId: string | null | undefined, updates: Record<string, unknown>): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(updates, 'category')) {
    if (organizationId) updates.category = await resolveCategorySlug(organizationId, updates.category);
    else delete updates.category;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'unit')) updates.unit = normalizeUnit(updates.unit);
}

/** Product.unit, or "piece" when unknown / not migrated yet. */
export async function productUnit(productId: string | null | undefined): Promise<string> {
  if (!productId) return 'piece';
  const { data, error } = await supabaseAdmin.from('Product').select('unit').eq('id', productId).maybeSingle();
  if (error || !data) return 'piece';
  return normalizeUnit((data as { unit?: string }).unit);
}
