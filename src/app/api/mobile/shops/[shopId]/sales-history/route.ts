import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/sales
 * Get sales history for a shop
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
    const startDate = searchParams.get('startDate') || null;
    const endDate = searchParams.get('endDate') || null;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Build query – avoid embedded Product() join in case FK is missing;
    // fall back to a separate product lookup.
    let query = supabaseAdmin
      .from('SalesEntry')
      .select('*', { count: 'exact' })
      .eq('shopId', shopId)
      .order('createdAt', { ascending: false });

    if (startDate) {
      query = query.gte('createdAt', startDate);
    }

    if (endDate) {
      query = query.lte('createdAt', endDate);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: sales, error: salesError, count } = await query;

    if (salesError) {
      logger.error('Mobile sales history query error', { 
        userId: auth.payload.userId,
        shopId,
        error: salesError.message,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch sales',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    // Fetch product details for all referenced productIds
    const productIds = [...new Set((sales || []).map((s: Record<string, unknown>) => s.productId as string))];
    const productMap = new Map<string, { name: string; sku: string }>();
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from('Product')
        .select('id, name, sku')
        .in('id', productIds);
      for (const p of (products || []) as { id: string; name: string; sku: string }[]) {
        productMap.set(p.id, { name: p.name, sku: p.sku });
      }
    }

    // Calculate summary
    const totalSales = count || 0;
    const totalAmount = (sales || []).reduce((sum: number, sale: Record<string, unknown>) => sum + ((sale.totalAmount as number) || 0), 0);
    const totalProfit = (sales || []).reduce((sum: number, sale: Record<string, unknown>) => {
      const profit = ((sale.totalAmount as number) || 0) - (((sale.costPrice as number) || 0) * ((sale.quantity as number) || 0));
      return sum + profit;
    }, 0);

    const salesList = (sales || []).map((sale: Record<string, unknown>) => {
      const product = productMap.get(sale.productId as string);
      return {
      saleId: sale.id,
      saleNumber: `SALE-${new Date(sale.createdAt as string).toISOString().split('T')[0].replace(/-/g, '')}-${(sale.id as string).substring(0, 6).toUpperCase()}`,
      timestamp: sale.createdAt,
      product: {
        name: product?.name ?? null,
        sku: product?.sku ?? null
      },
      quantity: sale.quantity,
      unitPrice: sale.unitPrice,
      totalAmount: sale.totalAmount,
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName
    };
    });

    const total = count || 0;
    const pages = Math.ceil(total / limit);

    logger.info('Mobile sales history retrieved', { 
      userId: auth.payload.userId,
      shopId,
      salesCount: salesList.length,
      endpoint: `/api/mobile/shops/${shopId}/sales`
    });

    return jsonResponse({
      success: true,
      data: {
        sales: salesList,
        pagination: {
          page,
          limit,
          total,
          pages
        },
        summary: {
          totalSales,
          totalAmount,
          totalProfit: Math.round(totalProfit * 100) / 100
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile sales history error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/sales'
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

