import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

type ShopStock = {
  id: string;
  quantity?: number | null;
  reorderLevel?: number | null;
  updatedAt?: string | null;
  Product: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
  } | null;
};

/**
 * GET /api/mobile/shops/[shopId]/inventory
 * Get detailed inventory for a shop
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
    const lowStock = searchParams.get('low_stock') === 'true';
    const category = searchParams.get('category') || null;

    // Build query
    let query = supabaseAdmin
      .from('ShopStock')
      .select('*, Product(*)')
      .eq('shopId', shopId);

    if (category) {
      query = query.eq('Product.category', category);
    }

    const { data: shopStocks, error: stockError } = await query;

    if (stockError) {
      logger.error('Mobile inventory query error', { 
        userId: auth.payload.userId,
        shopId,
        error: stockError.message,
        endpoint: `/api/mobile/shops/${shopId}/inventory`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch inventory',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    const shopStockList: ShopStock[] = (shopStocks ?? []) as ShopStock[];

    const inventory = shopStockList
      .map((ss: ShopStock) => {
        const quantity = Number(ss.quantity ?? 0);
        const reorderLevel = Number(ss.reorderLevel ?? 5);
        const daysToRunOut = quantity > 0 ? Math.ceil(quantity / 2) : 0;

        let status = 'in_stock';
        if (quantity === 0) {
          status = 'out_of_stock';
        } else if (quantity <= reorderLevel) {
          status = 'low_stock';
        }

        const product = ss.Product ?? {
          id: 'unknown',
          name: 'Unknown product',
          sku: null,
          category: null
        };

        return {
          id: ss.id,
          product: {
            id: product.id,
            name: product.name,
            sku: product.sku,
            category: product.category
          },
          quantity,
          reorderLevel,
          lastRestocked: ss.updatedAt,
          estimatedDaysToRunOut: daysToRunOut,
          status
        };
      })
      .filter(item => lowStock ? item.status === 'low_stock' || item.status === 'out_of_stock' : true)
      .sort((a, b) => {
        // Show out of stock first, then low stock
        const statusOrder = { out_of_stock: 0, low_stock: 1, in_stock: 2 };
        return statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder];
      });

    logger.info('Mobile inventory retrieved', { 
      userId: auth.payload.userId,
      shopId,
      itemCount: inventory.length,
      endpoint: `/api/mobile/shops/${shopId}/inventory`
    });

    return jsonResponse({
      success: true,
      data: {
        inventory
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile inventory error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/inventory'
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
