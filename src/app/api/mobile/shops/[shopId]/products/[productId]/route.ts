import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/products/[productId]
 * Get detailed product information.
 *
 * [productId] may be either:
 *   • The Product UUID  (preferred — returned as `id` in the products list)
 *   • The ShopStock UUID (fallback — returned as `shopStockId` in the products list)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; productId: string }> }
) {
  try {
    const { shopId, productId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    // ── Primary lookup: ShopStock row where Product.id = productId ──────────
    // Use the explicit FK alias so Supabase can resolve the join reliably.
    let { data: shopStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*, Product!ShopStock_productId_fkey(*)')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .maybeSingle();

    // ── Fallback: maybe the caller passed the ShopStock.id instead ───────────
    if (!shopStock && !stockError) {
      const fallback = await supabaseAdmin
        .from('ShopStock')
        .select('*, Product!ShopStock_productId_fkey(*)')
        .eq('shopId', shopId)
        .eq('id', productId)
        .maybeSingle();

      if (!fallback.error && fallback.data) {
        shopStock = fallback.data;
        stockError = null;
      }
    }

    if (stockError || !shopStock) {
      logger.warn('Mobile product not found', { 
        userId: auth.payload.userId,
        shopId,
        productId,
        supabaseError: stockError?.message ?? null,
        endpoint: `/api/mobile/shops/${shopId}/products/${productId}`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Product not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // The Product relation may arrive as an object or an array (Supabase quirk with some FK configs)
    const prod = Array.isArray(shopStock.Product) ? shopStock.Product[0] : shopStock.Product;

    if (!prod) {
      logger.warn('Mobile product: ShopStock found but Product relation is null', {
        userId: auth.payload.userId,
        shopId,
        productId,
        shopStockId: shopStock.id,
        endpoint: `/api/mobile/shops/${shopId}/products/${productId}`
      });
      return jsonResponse({
        success: false,
        error: 'Product data unavailable',
        code: 'NOT_FOUND'
      }, 404);
    }

    logger.info('Mobile product details retrieved', {
      userId: auth.payload.userId,
      shopId,
      productId,
      endpoint: `/api/mobile/shops/${shopId}/products/${productId}`
    });

    return jsonResponse({
      success: true,
      data: {
        product: {
          id: prod.id,
          shopStockId: shopStock.id,
          name: prod.name,
          sku: prod.sku,
          category: prod.category,
          description: prod.description,
          price: prod.price,
          costPrice: prod.costPrice || 0,
          quantity: shopStock.quantity,
          images: prod.images || [],
          colors: prod.colors || [],
          sizes: prod.sizes || [],
          reorderLevel: shopStock.reorderLevel || 5
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile product details error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/products/[productId]'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * PUT /api/mobile/shops/[shopId]/products/[productId]
 * Update product details (name, description, price, costPrice, images, sizes, colors, sku)
 * and/or stock fields (quantity, reorderLevel / minimumStockLevel).
 *
 * [productId] may be the Product UUID or the ShopStock UUID.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; productId: string }> }
) {
  try {
    const { shopId, productId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const body = await request.json() as Record<string, unknown>;

    // Resolve the ShopStock row (supports both Product UUID and ShopStock UUID)
    let { data: shopStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('id, productId, quantity, reorderLevel')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .maybeSingle();

    if (!shopStock && !stockError) {
      const fallback = await supabaseAdmin
        .from('ShopStock')
        .select('id, productId, quantity, reorderLevel')
        .eq('shopId', shopId)
        .eq('id', productId)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        shopStock = fallback.data;
        stockError = null;
      }
    }

    if (stockError || !shopStock) {
      logger.warn('Mobile product update: product not found', { userId: auth.payload.userId, shopId, productId });
      return jsonResponse({ success: false, error: 'Product not found', code: 'NOT_FOUND' }, 404);
    }

    const resolvedProductId = shopStock.productId as string;

    // ── Update Product table fields ──────────────────────────────────────────
    const allowedProductFields = ['name', 'description', 'price', 'costPrice', 'images', 'sizes', 'colors', 'sku', 'category', 'featured', 'trending'];
    const productUpdates: Record<string, unknown> = {};
    for (const k of allowedProductFields) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        productUpdates[k] = body[k];
      }
    }

    if (Object.keys(productUpdates).length > 0) {
      productUpdates.updatedAt = new Date().toISOString();
      const { error: prodUpdateError } = await supabaseAdmin
        .from('Product')
        .update(productUpdates)
        .eq('id', resolvedProductId);

      if (prodUpdateError) {
        logger.error('Mobile product update: Product table update failed', {
          userId: auth.payload.userId, shopId, productId: resolvedProductId,
          error: prodUpdateError.message,
        });
        return jsonResponse({ success: false, error: 'Failed to update product', code: 'INTERNAL_ERROR' }, 500);
      }
    }

    // ── Update ShopStock fields ───────────────────────────────────────────────
    const stockUpdates: Record<string, unknown> = {};
    if (body.quantity !== undefined) stockUpdates.quantity = Number(body.quantity);
    if (body.reorderLevel !== undefined) stockUpdates.reorderLevel = Number(body.reorderLevel);
    if (body.minimumStockLevel !== undefined) stockUpdates.reorderLevel = Number(body.minimumStockLevel);

    if (Object.keys(stockUpdates).length > 0) {
      const { error: stockUpdateError } = await supabaseAdmin
        .from('ShopStock')
        .update(stockUpdates)
        .eq('id', shopStock.id);

      if (stockUpdateError) {
        logger.warn('Mobile product update: ShopStock update failed', {
          userId: auth.payload.userId, shopId, shopStockId: shopStock.id,
          error: stockUpdateError.message,
        });
      }
    }

    // Fetch updated record to return
    const { data: updatedStock } = await supabaseAdmin
      .from('ShopStock')
      .select('*, Product!ShopStock_productId_fkey(*)')
      .eq('id', shopStock.id)
      .maybeSingle();

    const updatedProd = updatedStock
      ? (Array.isArray(updatedStock.Product) ? updatedStock.Product[0] : updatedStock.Product)
      : null;

    logger.info('Mobile product updated', { userId: auth.payload.userId, shopId, productId: resolvedProductId });

    return jsonResponse({
      success: true,
      data: {
        id: updatedProd?.id ?? resolvedProductId,
        shopStockId: shopStock.id,
        name: updatedProd?.name,
        sku: updatedProd?.sku,
        category: updatedProd?.category,
        description: updatedProd?.description,
        price: updatedProd?.price,
        costPrice: updatedProd?.costPrice || 0,
        quantity: updatedStock?.quantity ?? shopStock.quantity,
        images: updatedProd?.images || [],
        colors: updatedProd?.colors || [],
        sizes: updatedProd?.sizes || [],
        reorderLevel: updatedStock?.reorderLevel || 5,
      },
      message: 'Product updated successfully',
    }, 200);

  } catch (error) {
    logger.error('Mobile product update error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/products/[productId]',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
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
      'Access-Control-Allow-Methods': 'GET, PUT, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

