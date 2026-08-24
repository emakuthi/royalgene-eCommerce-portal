import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { getOrgShopIds } from '@/lib/mobile-org-shops';

type SalesEntry = {
  createdAt: string;
  totalAmount?: number | null;
  costPrice?: number | null;
  quantity?: number | null;
};

/**
 * GET /api/mobile/organization/analytics/sales
 * "All Shops" sales analytics for admins — same shape and query params as
 * GET /api/mobile/shops/[shopId]/analytics/sales, aggregated across every
 * shop in the caller's org (or platform-wide for a true super_admin).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = verifyMobileAuth(request);
    if (auth instanceof Response) return auth;
    if (!auth.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || null;
    const endDate = searchParams.get('endDate') || null;
    const groupBy = searchParams.get('groupBy') || 'day';

    const shopIds = await getOrgShopIds(auth.payload.organizationId ?? null);

    if (shopIds.length === 0) {
      return jsonResponse({
        success: true,
        data: { analytics: { totalSales: 0, totalRevenue: 0, totalProfit: 0, averageProfit: 0, profitMargin: 0, salesTrend: [] } },
      }, 200);
    }

    let query = supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .in('shopId', shopIds)
      .order('createdAt', { ascending: true });

    if (startDate) query = query.gte('createdAt', startDate);
    if (endDate) query = query.lte('createdAt', endDate);

    const { data: sales, error: salesError } = await query;

    if (salesError) {
      logger.error('Mobile org analytics query error', {
        userId: auth.payload.userId,
        error: salesError.message,
        endpoint: '/api/mobile/organization/analytics/sales',
      });
      return jsonResponse({ success: false, error: 'Failed to fetch analytics', code: 'INTERNAL_ERROR' }, 500);
    }

    const salesList: SalesEntry[] = (sales ?? []) as SalesEntry[];

    const totalSales = salesList.length;
    const totalRevenue = salesList.reduce((sum: number, s: SalesEntry) => sum + Number(s.totalAmount ?? 0), 0);
    const totalProfit = salesList.reduce((sum: number, s: SalesEntry) => {
      const totalAmount = Number(s.totalAmount ?? 0);
      const costPrice = Number(s.costPrice ?? 0);
      const quantity = Number(s.quantity ?? 0);
      return sum + (totalAmount - costPrice * quantity);
    }, 0);
    const averageProfit = totalSales > 0 ? totalProfit / totalSales : 0;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    const trendMap = new Map<string, { sales: number; revenue: number; profit: number }>();
    salesList.forEach((sale: SalesEntry) => {
      const date = new Date(sale.createdAt as string);
      let key = '';
      switch (groupBy) {
        case 'hour':
          key = date.toISOString().substring(0, 13);
          break;
        case 'week': {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        }
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
      trend.profit += totalAmount - costPrice * quantity;
    });

    const salesTrend = Array.from(trendMap.entries()).map(([date, data]) => ({
      date,
      sales: data.sales,
      revenue: Math.round(data.revenue * 100) / 100,
      profit: Math.round(data.profit * 100) / 100,
    }));

    logger.info('Mobile org analytics retrieved', {
      userId: auth.payload.userId,
      shopCount: shopIds.length,
      groupBy,
      totalSales,
      endpoint: '/api/mobile/organization/analytics/sales',
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
          salesTrend,
        },
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile org analytics error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/organization/analytics/sales',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
