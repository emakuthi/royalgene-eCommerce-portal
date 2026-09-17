// Helper utilities for portal product creation. This file exports createProductForShop so CLI scripts and tests can import it
import { v4 as uuidv4 } from 'uuid';
import { createProduct, hasValidCredentials } from '@/lib/supabase-db';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import util from 'util';
import { createShopStock, db } from '@/lib/db';
import type { Product, ShopStock } from '@/lib/types';

export type IncomingStock = { quantity?: number; lowStockThreshold?: number };
export type ShopStockWithProduct = ShopStock & { Product?: Product };

function asString(value: unknown, fallback: string = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback: number = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function createProductForShop(
  productData: Record<string, unknown>,
  stockData: IncomingStock,
  shopId: string,
  _userId?: string,
  organizationId?: string,
  /** Client-generated id for an offline-created product — makes a retried create idempotent. */
  clientProductId?: string,
): Promise<ShopStockWithProduct | ShopStock | undefined> {
  if (!organizationId) {
    throw new Error('organizationId is required to create a product');
  }

  // Offline-first replay: this exact product (by client id) was already
  // created — return it + its ShopStock at this shop instead of creating a
  // second one under a different id.
  if (clientProductId) {
    const { data: existingProduct } = await supabaseAdmin
      .from('Product').select('*').eq('id', clientProductId).eq('organizationId', organizationId).maybeSingle();
    if (existingProduct) {
      const { data: existingStock } = await supabaseAdmin
        .from('ShopStock').select('*').eq('shopId', shopId).eq('productId', clientProductId).maybeSingle();
      if (existingStock) {
        return { ...(existingStock as ShopStock), Product: existingProduct as Product };
      }
    }
  }

  // create product then shop stock; try Supabase createProduct, fallback to in-memory DB
  let newProduct: Product | null;

  const allowedCategories = ['dresses', 'shoes', 'trousers', 'textiles'] as Product['category'][];
  let productCreatedInSupabase = true;

  try {
    // Coerce and validate category before calling createProduct
    const categoryRaw = productData['category'];
    const category = typeof categoryRaw === 'string' && allowedCategories.includes(categoryRaw as Product['category'])
      ? (categoryRaw as Product['category'])
      : 'dresses';

    // Store price exactly as entered (major currency units). Do NOT convert to cents.
    const priceValue = asNumber(productData['price']);

    newProduct = await createProduct({
      organizationId,
      id: clientProductId,
      name: asString(productData['name']),
      description: asString(productData['description']),
      price: priceValue,
      // costPrice is also in major units (KES), not cents. Product.costPrice
      // is NOT NULL with a column default — the key must be OMITTED (not
      // set to `undefined`) when the caller didn't provide one, so that
      // default applies. An explicit `costPrice: undefined` key gets
      // serialized by supabase-js as a literal SQL NULL, not dropped like
      // plain JSON.stringify would — this exact mistake silently violated
      // the not-null constraint on every product create without a
      // costPrice, which is what caused the incident this comment is next
      // to (see [[critical-product-creation-silently-broken]] in memory).
      ...(typeof productData['costPrice'] === 'number' ? { costPrice: productData['costPrice'] as number } : {}),
      category,
      images: (Array.isArray(productData['images']) ? (productData['images'] as unknown as string[]) : []) || [],
      sizes: (Array.isArray(productData['sizes']) ? (productData['sizes'] as unknown as string[]) : []) || [],
      colors: (Array.isArray(productData['colors']) ? (productData['colors'] as unknown as string[]) : []) || [],
      stockQuantity: asNumber(productData['stockQuantity']),
      sku: asString(productData['sku']),
      brand: asString(productData['brand']) || undefined,
      featured: Boolean(productData['featured']),
      trending: Boolean(productData['trending']),
    });

    if (!newProduct) {
      throw new Error('Product creation returned null');
    }
  } catch (err) {
    // The in-memory fallback below is a LOCAL-DEV-ONLY convenience for
    // running this app without Supabase configured at all. If credentials
    // ARE configured, this is a real production failure — surface it
    // instead of silently faking a success the product was never actually
    // saved for (this exact silent-fallback masked a real Product-insert
    // failure for months in production before it was caught: every
    // "created" product just vanished on the next request).
    if (hasValidCredentials()) {
      logger.error('Product creation failed with valid Supabase credentials — refusing the in-memory fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err instanceof Error ? err : new Error('Failed to create product in Supabase');
    }

    // mark that product creation failed for Supabase and we used the in-memory fallback
    productCreatedInSupabase = false;
    // fallback to in-memory product creation
    const now = new Date().toISOString();
    const prod: Product = {
      id: clientProductId ?? uuidv4(),
      organizationId,
      name: asString(productData['name']),
      description: asString(productData['description']),
      price: asNumber(productData['price']),
      costPrice: typeof productData['costPrice'] === 'number' ? (productData['costPrice'] as number) : undefined,
      category: (typeof productData['category'] === 'string' ? (productData['category'] as Product['category']) : 'dresses'),
      images: (Array.isArray(productData['images']) ? (productData['images'] as unknown as string[]) : []) || [],
      sizes: (Array.isArray(productData['sizes']) ? (productData['sizes'] as unknown as string[]) : []) || [],
      colors: (Array.isArray(productData['colors']) ? (productData['colors'] as unknown as string[]) : []) || [],
      stockQuantity: asNumber(productData['stockQuantity']),
      sku: asString(productData['sku']),
      brand: asString(productData['brand']) || undefined,
      featured: Boolean(productData['featured']),
      trending: Boolean(productData['trending']),
      createdAt: now,
      updatedAt: now,
    } as Product;

    // Do not attach internal supabase error details to in-memory product (avoid leaking internals to consumers)
    // Errors are logged server-side; keep the in-memory product shape clean.

    // push to in-memory db
    try {
      db.products.push(prod);
    } catch (e) {
      logger.warn('Failed to push product to in-memory db', { error: e instanceof Error ? e.message : String(e) });
    }
    newProduct = prod;
  }

  if (!newProduct) {
    throw new Error('Failed to create product');
  }

  // If product was created in Supabase, ensure it is actually persisted before creating ShopStock
  if (productCreatedInSupabase) {
    const maxAttempts = 5;
    let foundInDb = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data: prodCheck, error: checkErr } = await supabaseAdmin
          .from('Product')
          .select('id')
          .eq('id', newProduct.id)
          .maybeSingle();

        if (checkErr) {
          logger.warn('Product existence check error', { productId: newProduct.id, attempt, error: checkErr });
        }

        if (prodCheck && (prodCheck as Record<string, unknown>).id === newProduct.id) {
          foundInDb = true;
          break;
        }
      } catch (e) {
        logger.warn('Product existence check threw', { productId: newProduct.id, attempt, error: e instanceof Error ? e.message : String(e) });
      }

      // small backoff before retry
      await new Promise(res => setTimeout(res, 300 * attempt));
    }

    if (!foundInDb) {
      // If product not found in Supabase after retries, log and mark as in-memory to avoid FK violation
      logger.warn('Created product not found in Supabase after retries; using in-memory fallback for ShopStock', { productId: newProduct.id });
      productCreatedInSupabase = false;
    }
  }

  const stockRecord = {
    id: uuidv4(),
    organizationId,
    shopId,
    productId: newProduct.id,
    quantity: Number(stockData?.quantity ?? 0),
    lowStockThreshold: Number(stockData?.lowStockThreshold ?? 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // If the product doesn't exist in Supabase (we created it in-memory), skip attempting to upsert ShopStock
  if (!productCreatedInSupabase) {
    logger.warn('Product was created in-memory; skipping ShopStock insert to Supabase and returning in-memory record', { productId: newProduct.id, shopId });
    const created = createShopStock(stockRecord);
    ((created as unknown) as Record<string, unknown>).Product = newProduct;
    ((created as unknown) as Record<string, unknown>).inMemoryFallback = true;
    return (created as unknown) as ShopStockWithProduct;
  }

  try {
    // Upsert ShopStock without embedding related Product to avoid PostgREST embedding ambiguity
    const { data: upsertData, error: upsertError } = await supabaseAdmin
      .from('ShopStock')
      .upsert([stockRecord], { onConflict: 'shopId,productId' })
      .select();

    if (upsertError) {
      // Rethrow so outer catch can capture structured error info
      throw upsertError;
    }

    const created = Array.isArray(upsertData) && upsertData.length > 0 ? (upsertData[0] as ShopStockWithProduct) : undefined;

    // Try to fetch the Product separately and attach it to the returned ShopStock for parity with previous shape
    if (created && stockRecord.productId) {
      try {
        const { data: prodData, error: prodErr } = await supabaseAdmin
          .from('Product')
          .select('*')
          .eq('id', stockRecord.productId)
          .maybeSingle();

        if (prodErr) {
          logger.warn('Failed to fetch Product after ShopStock upsert', { productId: stockRecord.productId, error: prodErr });
        } else if (prodData) {
          (created as ShopStockWithProduct).Product = prodData as Product;
        }
      } catch (fetchErr) {
        logger.warn('Exception when fetching Product after ShopStock upsert', { productId: stockRecord.productId, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) });
      }
    }

    return created;
  } catch (err) {
    // Log the Supabase failure so it's visible in server logs
    const safeStringify = (obj: unknown) => {
      try {
        if (typeof obj === 'string') return obj;
        // Try to serialize known properties first
        return JSON.stringify(obj, Object.getOwnPropertyNames(obj as object));
      } catch (e) {
        try {
          return String(obj);
        } catch (e2) {
          return '[unserializable error]';
        }
      }
    };

    const errObj = err as Record<string, unknown> | undefined;
    const errInfo = {
      message: errObj && typeof errObj.message === 'string' ? (errObj.message as string) : undefined,
      details: errObj && typeof errObj.details === 'string' ? (errObj.details as string) : undefined,
      hint: errObj && typeof errObj.hint === 'string' ? (errObj.hint as string) : undefined,
      status: errObj && (typeof errObj.status === 'number' || typeof errObj.status === 'string') ? errObj.status : undefined,
      code: errObj && (typeof errObj.code === 'string' || typeof errObj.code === 'number') ? errObj.code : undefined,
    };

    // Same reasoning as the Product-insert catch above: the Product row
    // above DID land for real in Supabase at this point, so silently
    // faking an in-memory ShopStock here on a real failure would leave a
    // genuine Product with no durable stock anywhere while still
    // reporting success. Only fall back when Supabase isn't configured
    // at all.
    if (hasValidCredentials()) {
      logger.error('ShopStock creation failed with valid Supabase credentials — refusing the in-memory fallback', {
        error: safeStringify(err),
        errorInspect: util.inspect(err, { depth: null, getters: true }),
        supabaseError: errInfo,
        stockRecord: { shopId: stockRecord.shopId, productId: stockRecord.productId, quantity: stockRecord.quantity },
      });
      throw err instanceof Error ? err : new Error('Failed to create ShopStock in Supabase');
    }

    logger.warn('Failed to create ShopStock in Supabase, falling back to in-memory DB', {
      // Provide a deep util.inspect dump so nested error fields are visible in logs
      error: safeStringify(err),
      errorInspect: util.inspect(err, { depth: null, getters: true }),
      supabaseError: errInfo,
      stockRecord: { shopId: stockRecord.shopId, productId: stockRecord.productId, quantity: stockRecord.quantity },
    });

    // fallback to in-memory DB
    const created = createShopStock(stockRecord);
    // attach product to the in-memory returned record for parity with Supabase shape
    ((created as unknown) as Record<string, unknown>).Product = newProduct;
    // mark that this record is an in-memory fallback so callers can surface a helpful notice
    ((created as unknown) as Record<string, unknown>).inMemoryFallback = true;
    return (created as unknown) as ShopStockWithProduct;
  }
}
