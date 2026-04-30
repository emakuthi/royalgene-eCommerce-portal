import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/dashboard
 * Get dashboard summary for a shop
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
    const period = searchParams.get('period') || 'today';

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now);

    switch (period) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'today':
      default:
        startDate.setHours(0, 0, 0, 0);
    }

    // Get sales data – plain select to avoid missing FK issues
    const { data: sales, error: salesError } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('shopId', shopId)
      .gte('createdAt', startDate.toISOString());

    if (salesError) {
      logger.error('Mobile dashboard query error', { 
        userId: auth.payload.userId,
        shopId,
        error: salesError.message,
        endpoint: `/api/mobile/shops/${shopId}/dashboard`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch dashboard data',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    const salesList = sales || [];

    // Fetch product names for all referenced productIds
    const productIds = [...new Set(salesList.map((s: Record<string, unknown>) => s.productId as string))];
    const productNameMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from('Product')
        .select('id, name')
        .in('id', productIds);
      for (const p of (products || []) as { id: string; name: string }[]) {
        productNameMap.set(p.id, p.name);
      }
    }

    const totalSales = salesList.length;
    const totalRevenue = salesList.reduce((sum: number, s: Record<string, unknown>) => sum + ((s.totalAmount as number) || 0), 0);
    const totalProfit = salesList.reduce((sum: number, s: Record<string, unknown>) => {
      const profit = ((s.totalAmount as number) || 0) - (((s.costPrice as number) || 0) * ((s.quantity as number) || 0));
      return sum + profit;
    }, 0);

    const averageTransactionValue = totalSales > 0 ? totalRevenue / totalSales : 0;

    // Get top product
    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    salesList.forEach((sale: Record<string, unknown>) => {
      const productId = sale.productId as string;
      if (!productMap.has(productId)) {
        productMap.set(productId, {
          name: productNameMap.get(productId) || 'Unknown',
          quantity: 0,
          revenue: 0
        });
      }
      const product = productMap.get(productId)!;
      product.quantity += (sale.quantity as number);
      product.revenue += (sale.totalAmount as number);
    });

    let topProduct = null;
    if (productMap.size > 0) {
      const topEntry = Array.from(productMap.entries()).reduce((a, b) =>
        a[1].revenue > b[1].revenue ? a : b
      );
      topProduct = topEntry[1];
    }

    // Get sales by payment method
    const paymentMethodMap = new Map<string, number>();
    salesList.forEach((sale: Record<string, unknown>) => {
      const method = (sale.paymentMethod as string) || 'cash';
      paymentMethodMap.set(method, (paymentMethodMap.get(method) || 0) + 1);
    });

    const salesByPaymentMethod: Record<string, number> = {};
    paymentMethodMap.forEach((count, method) => {
      salesByPaymentMethod[method] = count;
    });

    // Get top products (limit to 5)
    const topProducts = Array.from(productMap.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([_, product]) => product);

    logger.info('Mobile dashboard retrieved', { 
      userId: auth.payload.userId,
      shopId,
      period,
      totalSales,
      endpoint: `/api/mobile/shops/${shopId}/dashboard`
    });

    return jsonResponse({
      success: true,
      data: {
        summary: {
          totalSales,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          averageTransactionValue: Math.round(averageTransactionValue * 100) / 100,
          topProduct
        },
        metrics: {
          salesByPaymentMethod,
          topProducts
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile dashboard error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/dashboard'
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
