import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { createProductForShop } from '@/lib/portal-products';
/**
 * GET /api/mobile/shops/[shopId]/products
 * Get available products in a shop with current stock levels
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || null;
    const search = searchParams.get('search') || null;
    // Validate numeric query params and provide safe defaults
    let page = parseInt(searchParams.get('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get('limit') || '20', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;

    logger.info('Mobile products request params', {
      userId: auth.payload.userId,
      shopId,
      category,
      search,
      page,
      limit,
      endpoint: `/api/mobile/shops/${shopId}/products`
    });

    // Build query.
    // Use !inner so that filtering on Product columns actually excludes ShopStock rows
    // (a regular join would return the row with Product: null instead of omitting it).
    let query = supabaseAdmin
      .from('ShopStock')
      .select('*, Product!ShopStock_productId_fkey!inner(*)', { count: 'exact' })
      .eq('shopId', shopId)
      .gt('quantity', 0);

    if (category) {
      // With !inner join, eq on the related table column correctly filters parent rows
      query = query.eq('Product.category', category);
    }

    if (search) {
      // referencedTable option is required for or() to filter on related-table columns
      query = query.or(
        `name.ilike.%${search}%,sku.ilike.%${search}%`,
        { referencedTable: 'Product' }
      );
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: shopStocks, error: stockError, count } = await query;

    if (stockError) {
      logger.error('Mobile products query error', { 
        userId: auth.payload.userId,
        shopId,
        error: stockError?.message || String(stockError),
        endpoint: `/api/mobile/shops/${shopId}/products`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch products',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    // Build product list — with !inner join Product is always present, but keep the
    // null-guard for safety in case the DB has orphaned ShopStock rows.
    const products = (shopStocks || [])
      .map((ss: Record<string, unknown>) => {
        const product = (ss as Record<string, unknown>)?.Product as Record<string, unknown> | null;
        if (!product) {
          logger.warn('Mobile products: ShopStock row missing Product relation', {
            shopStockId: ss?.id,
            shopId,
            userId: auth.payload.userId,
            endpoint: `/api/mobile/shops/${shopId}/products`
          });
          return null;
        }

        return {
          id: product.id,
          shopStockId: ss.id,
          name: product.name,
          sku: product.sku,
          category: product.category,
          description: product.description,
          price: product.price,
          costPrice: (product.costPrice as number) || 0,
          quantity: ss.quantity,
          images: (product.images as string[]) || [],
          colors: (product.colors as string[]) || [],
          sizes: (product.sizes as string[]) || []
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    // count from Supabase is accurate because !inner join excludes non-matching rows
    const total = typeof count === 'number' ? count : products.length;
    const pages = Math.ceil(total / limit);

    logger.info('Mobile products retrieved', { 
      userId: auth.payload.userId,
      shopId,
      productCount: products.length,
      endpoint: `/api/mobile/shops/${shopId}/products`
    });

    return jsonResponse({
      success: true,
      data: {
        products,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile products error', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      endpoint: '/api/mobile/shops/[shopId]/products'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * POST /api/mobile/shops/[shopId]/products
 * Create a new product in a shop (with ShopStock record)
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const body = await request.json();

    logger.info('Mobile create product request', {
      userId: auth.payload.userId,
      shopId,
      productName: body?.name,
      sku: body?.sku,
      endpoint: `/api/mobile/shops/${shopId}/products`,
    });

    // Validate required fields
    if (!body?.name || typeof body.name !== 'string') {
      return jsonResponse(
        { success: false, error: 'Product name is required', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    if (body.price == null || typeof body.price !== 'number' || body.price < 0) {
      return jsonResponse(
        { success: false, error: 'A valid price is required', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    // SKU uniqueness check (if sku provided)
    if (body.sku) {
      try {
        const { data: existing } = await supabaseAdmin
          .from('Product')
          .select('id')
          .eq('sku', body.sku)
          .maybeSingle();

        if (existing) {
          return jsonResponse(
            { success: false, error: 'SKU already exists', code: 'DUPLICATE_SKU' },
            400,
          );
        }
      } catch (skuErr) {
        logger.warn('Mobile create product: SKU uniqueness check failed, proceeding', {
          sku: body.sku,
          error: skuErr instanceof Error ? skuErr.message : String(skuErr),
        });
      }
    }

    // Build product data from the mobile request body
    const productData: Record<string, unknown> = {
      name: body.name,
      description: body.description || '',
      price: body.price,
      costPrice: typeof body.costPrice === 'number' ? body.costPrice : undefined,
      category: body.category, // createProductForShop will normalise/validate this
      images: Array.isArray(body.images) ? body.images : [],
      sizes: Array.isArray(body.sizes) ? body.sizes : [],
      colors: Array.isArray(body.colors) ? body.colors : [],
      stockQuantity: typeof body.quantity === 'number' ? body.quantity : 0,
      sku: body.sku || '',
      brand: body.brand || '',
      featured: Boolean(body.featured),
      trending: Boolean(body.trending),
    };

    const stockData = {
      quantity: typeof body.quantity === 'number' ? body.quantity : 0,
      lowStockThreshold: typeof body.minimumStockLevel === 'number' ? body.minimumStockLevel : 5,
    };

    const result = await createProductForShop(productData, stockData, shopId, auth.payload.userId);

    if (!result) {
      logger.error('Mobile create product returned null', {
        userId: auth.payload.userId,
        shopId,
        endpoint: `/api/mobile/shops/${shopId}/products`,
      });
      return jsonResponse(
        { success: false, error: 'Failed to create product', code: 'INTERNAL_ERROR' },
        500,
      );
    }

    const product = 'Product' in result ? result.Product : undefined;

    logger.info('Mobile product created', {
      userId: auth.payload.userId,
      shopId,
      productId: product?.id ?? result.productId,
      shopStockId: result.id,
      endpoint: `/api/mobile/shops/${shopId}/products`,
    });

    return jsonResponse(
      {
        success: true,
        data: {
          id: product?.id ?? result.productId,
          shopStockId: result.id,
          name: product?.name ?? productData.name,
          sku: product?.sku ?? productData.sku,
          category: product?.category ?? productData.category,
          description: product?.description ?? productData.description,
          price: product?.price ?? productData.price,
          costPrice: product?.costPrice ?? productData.costPrice,
          quantity: result.quantity ?? stockData.quantity,
          images: product?.images ?? productData.images,
          colors: product?.colors ?? productData.colors,
          sizes: product?.sizes ?? productData.sizes,
        },
        message: 'Product created successfully',
      },
      201,
    );
  } catch (error) {
    logger.error('Mobile create product error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      endpoint: '/api/mobile/shops/[shopId]/products',
    });
    return jsonResponse(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      500,
    );
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(_request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

