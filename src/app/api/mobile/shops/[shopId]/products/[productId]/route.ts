import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/products/[productId]
 * Get detailed product information
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; productId: string }> }
) {
  try {
    const { shopId, productId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    // Get shop stock for this product
    const { data: shopStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*, Product(*)')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .single();

    if (stockError || !shopStock) {
      logger.warn('Mobile product not found', { 
        userId: auth.payload.userId,
        shopId,
        productId,
        endpoint: `/api/mobile/shops/${shopId}/products/${productId}`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Product not found',
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
          id: shopStock.Product.id,
          shopStockId: shopStock.id,
          name: shopStock.Product.name,
          sku: shopStock.Product.sku,
          category: shopStock.Product.category,
          description: shopStock.Product.description,
          price: shopStock.Product.price,
          costPrice: shopStock.Product.costPrice || 0,
          quantity: shopStock.quantity,
          images: shopStock.Product.images || [],
          colors: shopStock.Product.colors || [],
          sizes: shopStock.Product.sizes || [],
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
 * OPTIONS handler for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

