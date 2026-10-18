// Barcode scan resolution, shared by the portal and mobile lookup routes.
//
// A scanned string resolves in two steps:
//   1. ProductBarcode  — an explicit code registered for the organization, which may
//      also pin a size/colour cell (so one scan picks the exact variant).
//   2. Product.sku     — fallback, so shops can scan labels printed from their SKUs
//      before anyone has registered a dedicated barcode.
// Then the product is matched to the shop's own ShopStock row, so the caller gets
// everything a sale or a stock receipt needs from one request.

import { supabaseAdmin } from '@/lib/supabase-client';

/** Trim and collapse whitespace; scanners sometimes append CR/LF or a stray space. */
export function normalizeBarcode(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\r\n\t]/g, '').trim() : '';
}

export type BarcodeMatchSource = 'barcode' | 'sku';

export type BarcodeLookupResult =
  | {
      found: true;
      source: BarcodeMatchSource;
      code: string;
      product: {
        id: string;
        name: string;
        sku: string | null;
        price: number | null;
        category: string | null;
        images: unknown;
      };
      /** The shop's stock row for this product, or null when the shop doesn't stock it yet. */
      shopStock: { id: string; quantity: number } | null;
      /** Size/colour cell the code points at ('' / '' when it covers the whole product). */
      variant: { size: string; color: string; quantity: number | null } | null;
    }
  | { found: false; code: string };

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  category: string | null;
  images: unknown;
};

const PRODUCT_COLUMNS = 'id, name, sku, price, category, images';

/**
 * Resolve a scanned code for one shop. The caller must already have verified
 * that `shopId` belongs to `organizationId` — this only scopes the product
 * and barcode lookups to the organization.
 */
export async function resolveBarcode(params: {
  organizationId: string;
  shopId: string;
  code: string;
}): Promise<BarcodeLookupResult> {
  const code = normalizeBarcode(params.code);
  if (!code) return { found: false, code };

  let product: ProductRow | null = null;
  let source: BarcodeMatchSource = 'barcode';
  let size = '';
  let color = '';

  // 1. Registered barcode (case-insensitive, matches the unique index expression).
  const { data: barcodeRows } = await supabaseAdmin
    .from('ProductBarcode')
    .select('productId, size, color')
    .eq('organizationId', params.organizationId)
    .ilike('code', escapeLike(code))
    .limit(1);

  const hit = barcodeRows?.[0] as { productId: string; size: string; color: string } | undefined;
  if (hit) {
    const { data } = await supabaseAdmin
      .from('Product')
      .select(PRODUCT_COLUMNS)
      .eq('id', hit.productId)
      .eq('organizationId', params.organizationId)
      .maybeSingle();
    if (data) {
      product = data as unknown as ProductRow;
      size = hit.size ?? '';
      color = hit.color ?? '';
    }
  }

  // 2. SKU fallback.
  if (!product) {
    const { data } = await supabaseAdmin
      .from('Product')
      .select(PRODUCT_COLUMNS)
      .eq('organizationId', params.organizationId)
      .ilike('sku', escapeLike(code))
      .limit(1);
    const row = data?.[0] as unknown as ProductRow | undefined;
    if (row) {
      product = row;
      source = 'sku';
    }
  }

  if (!product) return { found: false, code };

  const { data: stockRows } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity')
    .eq('shopId', params.shopId)
    .eq('productId', product.id)
    .limit(1);
  const stock = stockRows?.[0] as { id: string; quantity: number | null } | undefined;
  const shopStock = stock ? { id: stock.id, quantity: Number(stock.quantity ?? 0) } : null;

  let variant: { size: string; color: string; quantity: number | null } | null = null;
  if (shopStock && (size || color)) {
    const { data: cell } = await supabaseAdmin
      .from('ShopStockVariant')
      .select('quantity')
      .eq('shopStockId', shopStock.id)
      .eq('size', size)
      .eq('color', color)
      .maybeSingle();
    variant = { size, color, quantity: cell ? Number((cell as { quantity: number }).quantity ?? 0) : 0 };
  } else if (size || color) {
    variant = { size, color, quantity: null };
  }

  return { found: true, source, code, product, shopStock, variant };
}

/** Escape LIKE wildcards so ilike() behaves as a case-insensitive equality check. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export type BarcodeInput = { code: string; size?: string; color?: string };

export type BarcodeValidationResult =
  | { ok: true; barcodes: Required<BarcodeInput>[] }
  | { ok: false; error: string };

/** Validate and normalise a list of barcodes submitted for one product. */
export function validateBarcodeInputs(input: unknown): BarcodeValidationResult {
  if (!Array.isArray(input)) return { ok: false, error: 'barcodes must be an array' };
  if (input.length > 50) return { ok: false, error: 'A product can have at most 50 barcodes' };

  const seen = new Set<string>();
  const out: Required<BarcodeInput>[] = [];
  for (const entry of input) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const code = normalizeBarcode(raw.code);
    if (!code) return { ok: false, error: 'Every barcode needs a code' };
    if (code.length > 128) return { ok: false, error: `Barcode "${code.slice(0, 20)}…" is too long (max 128 characters)` };
    const key = code.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Barcode "${code}" is listed more than once` };
    seen.add(key);
    out.push({
      code,
      size: typeof raw.size === 'string' ? raw.size.trim() : '',
      color: typeof raw.color === 'string' ? raw.color.trim() : '',
    });
  }
  return { ok: true, barcodes: out };
}
