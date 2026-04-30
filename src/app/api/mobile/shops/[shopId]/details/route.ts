import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/details
 * Get shop details by ID
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    // Get shop details
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('Shop')
      // DB column is `phone`; request `phone` and map below
      .select('id, name, location, phone, address')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return jsonResponse({ 
        success: false, 
        error: 'Shop not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // Get total stock and today's sales
    const { data: shopStocks, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('quantity')
      .eq('shopId', shopId);

    const totalStock = (shopStocks || []).reduce((sum, ss) => sum + (ss.quantity || 0), 0);

    // Get today's sales amount
    const today = new Date().toISOString().split('T')[0];
    const { data: todaysSales, error: salesError } = await supabaseAdmin
      .from('SalesEntry')
      .select('totalAmount')
      .eq('shopId', shopId)
      .gte('createdAt', `${today}T00:00:00Z`)
      .lt('createdAt', `${today}T23:59:59Z`);

    const totalSalestoday = (todaysSales || []).reduce((sum, sale: Record<string, unknown>) => sum + ((sale.totalAmount as number) || 0), 0);

    logger.info('Mobile shop details retrieved', { 
      userId: auth.payload.userId,
      shopId,
      endpoint: `/api/mobile/shops/${shopId}/details`
    });

    const s = shop as Record<string, unknown>;
    const phoneVal = s['phone'];
    const fallbackPhoneVal = s['phoneNumber'];
    const phoneNumber = typeof phoneVal === 'string' ? phoneVal : (typeof fallbackPhoneVal === 'string' ? fallbackPhoneVal : null);

    return jsonResponse({
      success: true,
      data: {
        shop: {
          id: typeof s['id'] === 'string' ? s['id'] : (typeof s['id'] === 'number' ? String(s['id']) : undefined),
          name: typeof s['name'] === 'string' ? s['name'] : undefined,
          location: typeof s['location'] === 'string' ? s['location'] : undefined,
          phoneNumber,
          address: typeof s['address'] === 'string' ? s['address'] : undefined,
          totalStock,
          totalSalestoday
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile shop details error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/details'
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

