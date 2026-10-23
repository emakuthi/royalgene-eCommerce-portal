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
  /** Organization.name — the workspace's display name. */
  businessName: string;
  businessType: BusinessTypeId;
  /** Name of product option 1 (stored in the `size` columns); '' = off. */
  option1Label: string;
  /** Name of product option 2 (stored in the `color` columns); '' = off. */
  option2Label: string;
  categories: ProductCategory[];
  units: readonly string[];
  /** Owner policy: staff must set an app lock (PIN/pattern) on their phone. */
  requireAppLock: boolean;
}

export const MIN_BUSINESS_NAME_LENGTH = 2;
export const MAX_BUSINESS_NAME_LENGTH = 100;

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
    .select('name, businessType, option1Label, option2Label')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) logger.warn('[business] getBusinessSettings failed', { organizationId, error: error.message });
  const row = (data ?? {}) as { name?: string; businessType?: string; option1Label?: string | null; option2Label?: string | null };
  const type = getBusinessType(row.businessType);
  let categories = await listProductCategories(organizationId);
  if (categories.length === 0 && !error) {
    // A workspace created without a type (e.g. Google sign-up) gets its starter list on first look.
    await seedCategoriesForType(organizationId, type.id);
    categories = await listProductCategories(organizationId);
  }
  return {
    businessName: row.name ?? '',
    businessType: type.id,
    option1Label: row.option1Label ?? type.option1Label,
    option2Label: row.option2Label ?? type.option2Label,
    categories,
    units: PRODUCT_UNITS,
    requireAppLock: await getRequireAppLock(organizationId),
  };
}

// Read on its own so the rest of the settings keep working before migration
// 20261023_01 adds the column (selecting a missing column fails the whole query).
async function getRequireAppLock(organizationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('requireAppLock')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) return false;
  return (data as { requireAppLock?: boolean } | null)?.requireAppLock === true;
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
  businessName?: unknown;
  businessType?: unknown;
  option1Label?: unknown;
  option2Label?: unknown;
  requireAppLock?: unknown;
}

function cleanBusinessName(raw: unknown): string {
  if (typeof raw !== 'string') throw new BusinessSettingsError('Business name must be text');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_BUSINESS_NAME_LENGTH || name.length > MAX_BUSINESS_NAME_LENGTH) {
    throw new BusinessSettingsError(`Business name must be ${MIN_BUSINESS_NAME_LENGTH}–${MAX_BUSINESS_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * Owner: change the business name, type, option names and/or the app-lock
 * policy. Switching type applies that type's option names (unless given
 * explicitly) and adds its starter categories; existing categories and
 * products are left alone — except in a workspace with no products yet,
 * where the previous type's untouched starter list is swapped out (a Google
 * sign-up starts as the default type before the owner has picked one).
 * Renaming also renames the shop that was auto-named after the workspace.
 */
export async function updateBusinessSettings(organizationId: string, patch: BusinessSettingsPatch): Promise<BusinessSettings> {
  const update: Record<string, unknown> = {};
  let newType: BusinessTypeId | null = null;
  let newName: string | null = null;
  let requireAppLock: boolean | null = null;

  if (patch.businessName !== undefined) {
    newName = cleanBusinessName(patch.businessName);
    update.name = newName;
  }
  if (patch.requireAppLock !== undefined) {
    if (typeof patch.requireAppLock !== 'boolean') throw new BusinessSettingsError('requireAppLock must be true or false');
    requireAppLock = patch.requireAppLock;
  }

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
  if (Object.keys(update).length === 0 && requireAppLock === null) throw new BusinessSettingsError('Nothing to update');

  let oldName: string | null = null;
  if (newName !== null) {
    const { data } = await supabaseAdmin.from('Organization').select('name').eq('id', organizationId).maybeSingle();
    oldName = (data as { name?: string } | null)?.name ?? null;
  }

  const now = new Date().toISOString();
  if (Object.keys(update).length > 0) {
    update.updatedAt = now;
    const { error } = await supabaseAdmin.from('Organization').update(update).eq('id', organizationId);
    if (error) throw new Error(error.message);
  }
  if (requireAppLock !== null) {
    const { error } = await supabaseAdmin
      .from('Organization')
      .update({ requireAppLock, updatedAt: now })
      .eq('id', organizationId);
    if (error) {
      logger.error('[business] requireAppLock update failed (migration 20261023_01 run?)', { organizationId, error: error.message });
      throw new BusinessSettingsError('The app lock setting is not available yet');
    }
  }

  if (newName !== null && oldName && oldName !== newName) {
    // The first shop is created with the workspace's name; keep them in step
    // unless the owner has already renamed the shop themselves.
    const { error } = await supabaseAdmin
      .from('Shop')
      .update({ name: newName, updatedAt: now })
      .eq('organizationId', organizationId)
      .eq('name', oldName);
    if (error) logger.warn('[business] default shop rename failed', { organizationId, error: error.message });
  }
  if (newType) await replaceStarterCategoriesIfEmpty(organizationId, newType);
  return getBusinessSettings(organizationId);
}

/** Adds [type]'s starter categories; in a workspace with no products yet, also hides the other starter ones. */
async function replaceStarterCategoriesIfEmpty(organizationId: string, type: BusinessTypeId): Promise<void> {
  await seedCategoriesForType(organizationId, type);
  const { count, error } = await supabaseAdmin
    .from('Product')
    .select('id', { count: 'exact', head: true })
    .eq('organizationId', organizationId);
  if (error || (count ?? 0) > 0) return;
  const keep = new Set(getBusinessType(type).categories.map(categorySlug));
  const others = (await listProductCategories(organizationId)).filter((c) => c.isActive && !keep.has(c.slug));
  if (others.length === 0) return;
  const { error: hideError } = await supabaseAdmin
    .from('ProductCategory')
    .update({ isActive: false })
    .in('id', others.map((c) => c.id));
  if (hideError) logger.warn('[business] hiding previous starter categories failed', { organizationId, error: hideError.message });
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
  if (Object.prototype.hasOwnProperty.call(updates, 'kind')) {
    if (updates.kind !== 'stock' && updates.kind !== 'menu') delete updates.kind;
  }
}

/** Product.unit, or "piece" when unknown / not migrated yet. */
export async function productUnit(productId: string | null | undefined): Promise<string> {
  if (!productId) return 'piece';
  const { data, error } = await supabaseAdmin.from('Product').select('unit').eq('id', productId).maybeSingle();
  if (error || !data) return 'piece';
  return normalizeUnit((data as { unit?: string }).unit);
}
