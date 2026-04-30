import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product, ShopStock } from '../types';

// Mocks must be set up before importing the module under test
vi.mock('../supabase-db', () => ({
  createProduct: vi.fn(),
}));

vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('../db', () => ({
  createShopStock: vi.fn(),
  db: { products: [] },
}));

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createProductForShop } from '../portal-products';
import { createProduct } from '../supabase-db';
import { supabaseAdmin } from '../supabase-client';
import { createShopStock, db } from '../db';

beforeEach(() => {
  vi.clearAllMocks();
  // reset in-memory db products
  (db as { products: Product[] }).products = [];
});

type ShopStockWithProduct = ShopStock & { Product?: Product; inMemoryFallback?: boolean };

describe('createProductForShop', () => {
  it('creates product and shopstock in Supabase when supabase succeeds', async () => {
    const product: Product = {
      id: 'p-1',
      name: 'Test Product',
      description: 'desc',
      price: 1000,
      category: 'dresses',
      images: [],
      sizes: [],
      colors: [],
      stockQuantity: 5,
      sku: 'SKU-1',
      featured: false,
      trending: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // mock createProduct to return product
    vi.mocked(createProduct).mockResolvedValue(product);

    // mock supabaseAdmin.from(...).upsert(...).select(...) chain
    const selectMock = vi.fn().mockResolvedValue({ data: [{ id: 's-1', shopId: 'shop-1', productId: 'p-1', quantity: 5, Product: product }], error: null });
    const upsertMock = vi.fn(() => ({ select: selectMock }));
    // Provide a typed mock for `supabaseAdmin.from` that handles both ShopStock (upsert) and Product (existence check)
    const productMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p-1' }, error: null });
    const productEq = vi.fn(() => ({ maybeSingle: productMaybeSingle }));
    const productSelect = vi.fn(() => ({ eq: productEq }));

    vi.mocked(supabaseAdmin).from.mockImplementation((relation: string) => {
      if (relation === 'ShopStock') {
        return { upsert: upsertMock } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      if (relation === 'Product') {
        return { select: productSelect } as unknown as ReturnType<typeof supabaseAdmin.from>;
      }
      // default fallback for other tables
      return {} as unknown as ReturnType<typeof supabaseAdmin.from>;
    });

    const res = await createProductForShop({ name: 'Test Product', sku: 'SKU-1', price: 10 }, { quantity: 5, lowStockThreshold: 1 }, 'shop-1');

    expect(createProduct).toHaveBeenCalled();
    expect(vi.mocked(supabaseAdmin).from).toHaveBeenCalledWith('ShopStock');
    expect(res).toBeDefined();
    const typed = res as ShopStockWithProduct;
    expect(typed.Product).toBeDefined();
    expect(typed.inMemoryFallback).toBeUndefined();
  });

  it('falls back to in-memory DB when Supabase create fails', async () => {
    // make createProduct throw so code falls back to in-memory product
    vi.mocked(createProduct).mockRejectedValue(new Error('Supabase down'));

    // make createShopStock return a ShopStock-shaped object so types align with the real signature
    vi.mocked(createShopStock).mockImplementation((rec: Partial<ShopStock> & { metadata?: Record<string, unknown> | null }) => ({
      // minimal fields to satisfy ShopStock
      id: typeof rec.id === 'string' && rec.id ? String(rec.id) : 's-fallback',
      shopId: String(rec.shopId ?? 'shop-f'),
      productId: String(rec.productId ?? 'p-f'),
      quantity: typeof rec.quantity === 'number' ? rec.quantity : Number(rec.quantity) || 0,
      lowStockThreshold: typeof rec.lowStockThreshold === 'number' ? rec.lowStockThreshold : Number(rec.lowStockThreshold) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: rec.metadata ?? null,
    } as ShopStock));

    const res = await createProductForShop({ name: 'Fail Product', sku: 'SKU-FAIL', price: 9.99 }, { quantity: 3, lowStockThreshold: 1 }, 'shop-f');

    expect(createProduct).toHaveBeenCalled();
    expect(vi.mocked(createShopStock)).toHaveBeenCalled();
    expect(res).toBeDefined();
    const typed = res as ShopStockWithProduct;
    expect(typed.inMemoryFallback).toBe(true);
    expect(typed.Product).toBeDefined();
  });
});
