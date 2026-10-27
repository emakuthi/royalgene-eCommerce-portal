import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * Live suggestions while typing a new product's name or SKU: products that
 * already exist anywhere in the business (any shop), so the same goods get
 * the same name and SKU everywhere instead of "Mint green dress" in one shop
 * and "mint grn dres" in another. Picking one fills the form from it.
 */

export interface ProductSuggestion {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  brand: string | null;
  price: number | null;
  sizes: string[];
  colors: string[];
  image: string | null;
  /** Shops that stock it. */
  shopNames: string[];
  /** True when the shop being added to already stocks it — adding again would duplicate it. */
  inThisShop: boolean;
}

const MAX_SUGGESTIONS = 8;

/** PostgREST `or()` filters break on these; they never matter for a name/SKU search. */
const clean = (q: string) => q.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim();

export async function suggestProducts(opts: {
  organizationId: string;
  query: string;
  /** The shop the product is being added to, to flag ones it already has. */
  shopId?: string | null;
}): Promise<ProductSuggestion[]> {
  const q = clean(opts.query);
  if (q.length < 2) return [];

  const { data } = await supabaseAdmin
    .from('Product')
    .select('id, name, sku, category, unit, brand, price, sizes, colors, images')
    .eq('organizationId', opts.organizationId)
    .is('deletedAt', null)
    .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
    .order('name', { ascending: true })
    .limit(40);
  const products = (data ?? []) as Array<Record<string, unknown>>;
  if (products.length === 0) return [];

  const { data: stockRows } = await supabaseAdmin
    .from('ShopStock')
    .select('productId, shopId')
    .in('productId', products.map((p) => p.id as string));
  const shopIdsByProduct = new Map<string, Set<string>>();
  for (const r of (stockRows ?? []) as Array<{ productId: string; shopId: string }>) {
    if (!shopIdsByProduct.has(r.productId)) shopIdsByProduct.set(r.productId, new Set());
    shopIdsByProduct.get(r.productId)!.add(r.shopId);
  }
  const allShopIds = [...new Set([...shopIdsByProduct.values()].flatMap((s) => [...s]))];
  const shopName = new Map<string, string>();
  if (allShopIds.length > 0) {
    // Separate lookup, not an embed — see product-sku.server.ts.
    const { data: shops } = await supabaseAdmin.from('Shop').select('id, name').in('id', allShopIds);
    for (const s of (shops ?? []) as Array<{ id: string; name: string }>) shopName.set(s.id, s.name);
  }

  // Same goods stocked in several shops can be separate products with the
  // same name + SKU — show each once, with every shop that has it.
  const lower = q.toLowerCase();
  const merged = new Map<string, ProductSuggestion & { rank: number }>();
  for (const p of products) {
    const name = String(p.name ?? '');
    const sku = (p.sku as string | null)?.trim() || null;
    const key = `${name.trim().toLowerCase()}\u0000${(sku ?? '').toLowerCase()}`;
    const shops = shopIdsByProduct.get(p.id as string) ?? new Set<string>();
    const existing = merged.get(key);
    if (existing) {
      for (const id of shops) {
        const n = shopName.get(id);
        if (n && !existing.shopNames.includes(n)) existing.shopNames.push(n);
      }
      existing.inThisShop ||= Boolean(opts.shopId && shops.has(opts.shopId));
      continue;
    }
    const images = Array.isArray(p.images) ? (p.images as string[]) : [];
    // Starts-with matches first, then contains.
    const rank = name.toLowerCase().startsWith(lower) || (sku ?? '').toLowerCase().startsWith(lower) ? 0 : 1;
    merged.set(key, {
      rank,
      productId: p.id as string,
      name,
      sku,
      category: (p.category as string | null) ?? null,
      unit: (p.unit as string | null) ?? null,
      brand: (p.brand as string | null) ?? null,
      price: typeof p.price === 'number' ? p.price : null,
      sizes: Array.isArray(p.sizes) ? (p.sizes as string[]) : [],
      colors: Array.isArray(p.colors) ? (p.colors as string[]) : [],
      image: images[0] ?? null,
      shopNames: [...shops].map((id) => shopName.get(id)).filter((n): n is string => Boolean(n)),
      inThisShop: Boolean(opts.shopId && shops.has(opts.shopId)),
    });
  }

  return [...merged.values()]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ rank: _rank, ...s }) => ({ ...s, shopNames: s.shopNames.sort() }));
}
