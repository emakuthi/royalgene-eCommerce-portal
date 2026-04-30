import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

type SalesEntry = {
  createdAt: string;
  totalAmount?: number | null;
  costPrice?: number | null;
  quantity?: number | null;
};

/**
 * GET /api/mobile/shops/[shopId]/analytics/sales
 * Get detailed sales analytics
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
    const groupBy = searchParams.get('groupBy') || 'day';

    // Build query
    let query = supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('shopId', shopId)
      .order('createdAt', { ascending: true });

    if (startDate) {
      query = query.gte('createdAt', startDate);
    }

    if (endDate) {
      query = query.lte('createdAt', endDate);
    }

    const { data: sales, error: salesError } = await query;

    if (salesError) {
      logger.error('Mobile analytics query error', { 
        userId: auth.payload.userId,
        shopId,
        error: salesError.message,
        endpoint: `/api/mobile/shops/${shopId}/analytics/sales`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch analytics',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    const salesList: SalesEntry[] = (sales ?? []) as SalesEntry[];

    // Calculate totals
    const totalSales = salesList.length;
    const totalRevenue = salesList.reduce((sum: number, s: SalesEntry) => sum + (Number(s.totalAmount ?? 0)), 0);
    const totalProfit = salesList.reduce((sum: number, s: SalesEntry) => {
      const totalAmount = Number(s.totalAmount ?? 0);
      const costPrice = Number(s.costPrice ?? 0);
      const quantity = Number(s.quantity ?? 0);
      const profit = totalAmount - (costPrice * quantity);
      return sum + profit;
    }, 0);
    const averageProfit = totalSales > 0 ? totalProfit / totalSales : 0;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    // Group sales by date/period
    const trendMap = new Map<string, { sales: number; revenue: number; profit: number }>();
    
    salesList.forEach((sale: SalesEntry) => {
      const date = new Date(sale.createdAt as string);
      let key = '';

      switch (groupBy) {
        case 'hour':
          key = date.toISOString().substring(0, 13);
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'day':
        default:
          key = date.toISOString().split('T')[0];
      }

      if (!trendMap.has(key)) {
        trendMap.set(key, { sales: 0, revenue: 0, profit: 0 });
      }

      const trend = trendMap.get(key)!;
      const totalAmount = Number(sale.totalAmount ?? 0);
      const costPrice = Number(sale.costPrice ?? 0);
      const quantity = Number(sale.quantity ?? 0);

      trend.sales += 1;
      trend.revenue += totalAmount;
      trend.profit += totalAmount - (costPrice * quantity);
    });

    const salesTrend = Array.from(trendMap.entries()).map(([date, data]) => ({
      date,
      sales: data.sales,
      revenue: Math.round(data.revenue * 100) / 100,
      profit: Math.round(data.profit * 100) / 100
    }));

    logger.info('Mobile analytics retrieved', { 
      userId: auth.payload.userId,
      shopId,
      groupBy,
      totalSales,
      endpoint: `/api/mobile/shops/${shopId}/analytics/sales`
    });

    return jsonResponse({
      success: true,
      data: {
        analytics: {
          totalSales,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          averageProfit: Math.round(averageProfit * 100) / 100,
          profitMargin: Math.round(profitMargin * 100) / 100,
          salesTrend
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile analytics error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/analytics/sales'
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
