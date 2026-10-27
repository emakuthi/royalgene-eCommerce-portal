import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { productUnit } from './business-settings.server';
import { hasVariantStock } from './variant-stock.server';

export interface SkuConflict {
  id: string;
  name: string;
  /** The shops where both products are stocked — where the clash actually is. */
  shopNames: string[];
}

/**
 * SKUs are unique per SHOP, not per business: different shops of the same
 * business may each have their own product with the same SKU (they receive
 * the same goods). Migration 20261023_02 dropped the old platform-wide
 * `Product_sku_key`. Products are business-wide and stocked per shop
 * (ShopStock), so the rule can't be a DB index — it's enforced here on
 * create/edit, and transfers keep it by adding into the receiving shop's
 * same-SKU product (see [resolveTransferDestination]).
 *
 * A blank SKU means "none" and never conflicts.
 */
export async function findSkuConflict(opts: {
  organizationId: string | null | undefined;
  sku: unknown;
  /** Create: the target shop. Edit: omit and pass `productId` instead. */
  shopIds?: string[];
  /** Edit: the product being edited — excluded, and its own shops are checked. */
  productId?: string;
}): Promise<SkuConflict | null> {
  const { organizationId, sku, productId } = opts;
  if (typeof sku !== 'string' || !sku.trim() || !organizationId) return null;

  let shopIds = opts.shopIds ?? [];
  if (!opts.shopIds && productId) {
    const { data: own } = await supabaseAdmin.from('ShopStock').select('shopId').eq('productId', productId);
    shopIds = (own ?? []).map((r: { shopId: string }) => r.shopId);
  }
  if (shopIds.length === 0) return null;

  let query = supabaseAdmin
    .from('Product')
    .select('id, name')
    .eq('organizationId', organizationId)
    .eq('sku', sku.trim());
  if (productId) query = query.neq('id', productId);
  const { data: sameSku } = await query.limit(50);
  const candidates = (sameSku ?? []) as Array<{ id: string; name: string }>;
  if (candidates.length === 0) return null;

  const { data: shared } = await supabaseAdmin
    .from('ShopStock')
    .select('productId, shopId')
    .in('productId', candidates.map((c) => c.id))
    .in('shopId', shopIds);
  const hits = (shared ?? []) as Array<{ productId: string; shopId: string }>;
  if (hits.length === 0) return null;

  const clash = candidates.find((c) => c.id === hits[0].productId)!;
  return { id: clash.id, name: clash.name, shopNames: await shopNamesFor(hits.filter((h) => h.productId === clash.id).map((h) => h.shopId)) };
}

async function shopNamesFor(shopIds: string[]): Promise<string[]> {
  const ids = [...new Set(shopIds)];
  if (ids.length === 0) return [];
  // Separate lookup rather than a PostgREST embed — an embed needs a
  // declared FK and 400s the whole query without one.
  const { data: shops } = await supabaseAdmin.from('Shop').select('name').in('id', ids);
  return (shops ?? []).map((s: { name: string }) => s.name).filter(Boolean).sort();
}

export interface TransferDestination {
  /** Existing ShopStock in the receiving shop to add into, or null to create one for `productId`. */
  stock: { id: string; quantity: number; productId: string } | null;
  /** The product the stock lands on — the source product, or the receiving shop's same-SKU product. */
  productId: string;
  /** True when the stock is being added to a different product that shares the SKU. */
  mergedBySku: boolean;
}

/**
 * Where transferred stock lands in the receiving shop: the same product if
 * that shop already stocks it; otherwise that shop's own product with the
 * same SKU (its count goes up — no second listing with the same SKU);
 * otherwise a new ShopStock row for the source product.
 *
 * Merging is refused (ok: false) when the two products can't be added
 * together safely: one is tracked by size/colour and the other isn't, or
 * they're counted in different units.
 */
export async function resolveTransferDestination(opts: {
  organizationId: string;
  productId: string;
  toShopId: string;
  toShopName: string;
  /** The source shop's ShopStock — its size/colour tracking must match the merge target's. */
  srcShopStockId: string | null;
}): Promise<{ ok: true; dest: TransferDestination } | { ok: false; error: string }> {
  const { organizationId, productId, toShopId, toShopName, srcShopStockId } = opts;

  const { data: exact } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity, productId')
    .eq('shopId', toShopId)
    .eq('productId', productId)
    .maybeSingle();
  if (exact) {
    return { ok: true, dest: { stock: exact as TransferDestination['stock'], productId, mergedBySku: false } };
  }

  const { data: source } = await supabaseAdmin
    .from('Product')
    .select('sku')
    .eq('id', productId)
    .maybeSingle();
  const sku = typeof source?.sku === 'string' ? source.sku.trim() : '';
  const none = { ok: true as const, dest: { stock: null, productId, mergedBySku: false } };
  if (!sku) return none;

  const { data: sameSku } = await supabaseAdmin
    .from('Product')
    .select('id, name')
    .eq('organizationId', organizationId)
    .eq('sku', sku)
    .neq('id', productId)
    .limit(50);
  const candidates = (sameSku ?? []) as Array<{ id: string; name: string }>;
  if (candidates.length === 0) return none;

  const { data: destRows } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity, productId')
    .eq('shopId', toShopId)
    .in('productId', candidates.map((c) => c.id))
    .limit(1);
  const match = destRows?.[0] as { id: string; quantity: number; productId: string } | undefined;
  if (!match) return none;

  const target = candidates.find((c) => c.id === match.productId)!;
  const srcVariant = srcShopStockId ? await hasVariantStock(srcShopStockId) : false;
  const destVariant = await hasVariantStock(match.id);
  // Size/colour stock into a plain count: only when that count is empty —
  // the sizes then simply land there. With stock in it, nobody knows its
  // sizes, so the receiving shop has to enter its breakdown first.
  if (srcVariant && !destVariant && Number(match.quantity) > 0) {
    return {
      ok: false,
      error: `"${target.name}" at ${toShopName} (SKU "${sku}") has ${Number(match.quantity)} in stock that isn't split by size/colour yet. Set its size/colour breakdown at ${toShopName} first, then transfer.`,
    };
  }
  if (!srcVariant && destVariant) {
    return {
      ok: false,
      error: `${toShopName} already has "${target.name}" with SKU "${sku}", tracked by size/colour, but this one isn't, so the stock can't be added to it. Track this one by size/colour too, or change one of the SKUs, then try again.`,
    };
  }
  if ((await productUnit(productId)) !== (await productUnit(target.id))) {
    return {
      ok: false,
      error: `${toShopName} already has "${target.name}" with SKU "${sku}", but it's counted in a different unit, so the stock can't be added to it. Change one of the SKUs, then try again.`,
    };
  }
  return { ok: true, dest: { stock: match, productId: target.id, mergedBySku: true } };
}

export interface TransferPreview {
  toShopId: string;
  toShopName: string;
  /**
   * existing — the receiving shop already stocks this same product (its count goes up);
   * merge    — it has its OWN product with the same SKU, which the stock is added to;
   * new      — it has neither, so the product is added to that shop;
   * blocked  — a same-SKU product is there but can't be merged (see `error`).
   */
  outcome: 'existing' | 'merge' | 'new' | 'blocked';
  error?: string;
  source: { productId: string; name: string; sku: string };
  /** What's already on the receiving side — shown so the user can spot name typos before confirming. */
  target: { productId: string; name: string; sku: string; quantity: number; price: number | null; unit: string; image: string | null } | null;
  /** Merge with names that don't match (ignoring case/extra spaces) — worth a second look. */
  namesDiffer: boolean;
}

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** What a transfer of `productId` into `toShopId` would do — read-only, same rule as the transfer itself. */
export async function buildTransferPreview(opts: {
  organizationId: string;
  productId: string;
  toShopId: string;
  toShopName: string;
  srcShopStockId: string | null;
}): Promise<TransferPreview> {
  const { data: src } = await supabaseAdmin.from('Product').select('id, name, sku').eq('id', opts.productId).maybeSingle();
  const source = { productId: opts.productId, name: (src?.name as string) ?? '', sku: ((src?.sku as string) ?? '').trim() };
  const base = { toShopId: opts.toShopId, toShopName: opts.toShopName, source };

  const resolved = await resolveTransferDestination(opts);
  if (!resolved.ok) {
    // Still show the product it clashed with, so the user sees the other side.
    const { data: same } = await supabaseAdmin
      .from('Product')
      .select('id')
      .eq('organizationId', opts.organizationId)
      .eq('sku', source.sku)
      .neq('id', opts.productId)
      .limit(50);
    const ids = ((same ?? []) as Array<{ id: string }>).map((r) => r.id);
    const { data: there } = ids.length
      ? await supabaseAdmin.from('ShopStock').select('id, quantity, productId').eq('shopId', opts.toShopId).in('productId', ids).limit(1)
      : { data: [] };
    const stock = (there?.[0] as { id: string; quantity: number; productId: string } | undefined) ?? null;
    const target = stock ? await describeTarget(stock) : null;
    return { ...base, outcome: 'blocked', error: resolved.error, target, namesDiffer: !!target && !sameName(target.name, source.name) };
  }

  const { dest } = resolved;
  if (!dest.stock) return { ...base, outcome: 'new', target: null, namesDiffer: false };
  const target = await describeTarget(dest.stock);
  return {
    ...base,
    outcome: dest.mergedBySku ? 'merge' : 'existing',
    target,
    namesDiffer: dest.mergedBySku && !sameName(target.name, source.name),
  };
}

async function describeTarget(stock: { quantity: number; productId: string }): Promise<NonNullable<TransferPreview['target']>> {
  const { data: p } = await supabaseAdmin
    .from('Product')
    .select('id, name, sku, price, unit, images')
    .eq('id', stock.productId)
    .maybeSingle();
  const images = Array.isArray(p?.images) ? (p.images as string[]) : [];
  return {
    productId: stock.productId,
    name: (p?.name as string) ?? '',
    sku: ((p?.sku as string) ?? '').trim(),
    quantity: Number(stock.quantity ?? 0),
    price: typeof p?.price === 'number' ? p.price : null,
    unit: (p?.unit as string) || 'piece',
    image: images[0] ?? null,
  };
}

/** A Postgres unique violation on the SKU — only possible before migration 20261023_02 runs. */
export function isSkuUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === '23505' && /sku/i.test(error.message ?? '');
}

/**
 * e.g. `Duplicate SKU: "T6160-1" is already used by "Mira fashion short" in
 * Main Shop. Please change the SKU and try again.`
 */
export function duplicateSkuMessage(sku: unknown, clash?: SkuConflict | null): string {
  const code = String(sku ?? '').trim();
  const skuPart = code ? `"${code}"` : 'This SKU';
  if (!clash) {
    return `Duplicate SKU: ${skuPart} is already used by another product. Please change the SKU and try again.`;
  }
  const where = clash.shopNames.length > 0 ? ` in ${joinNames(clash.shopNames)}` : '';
  return `Duplicate SKU: ${skuPart} is already used by "${clash.name}"${where}. Please change the SKU and try again.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 3) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more shop${names.length - 3 === 1 ? '' : 's'}`;
}

/**
 * Product.sku is NOT NULL, so "no SKU" is stored as ''. A null from a client
 * would fail the column.
 */
export function normalizeSku(sku: unknown): string {
  return typeof sku === 'string' ? sku.trim() : '';
}
