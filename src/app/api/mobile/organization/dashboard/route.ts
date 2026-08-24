import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { getOrgShopIds } from '@/lib/mobile-org-shops';

/**
 * GET /api/mobile/organization/dashboard
 * "All Shops" dashboard summary for admins — same shape as
 * GET /api/mobile/shops/[shopId]/dashboard, but aggregated across every
 * shop in the caller's org (or platform-wide for a true super_admin).
 * Admin-only: non-admin shopkeepers are always scoped to a single shop via
 * PortalUser and have no "All Shops" concept.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = verifyMobileAuth(request);
    if (auth instanceof Response) return auth;
    if (!auth.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'today';

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

    const shopIds = await getOrgShopIds(auth.payload.organizationId ?? null);

    if (shopIds.length === 0) {
      return jsonResponse({
        success: true,
        data: {
          summary: { totalSales: 0, totalRevenue: 0, totalProfit: 0, averageTransactionValue: 0, topProduct: null },
          metrics: { salesByPaymentMethod: {}, topProducts: [] },
        },
      }, 200);
    }

    const { data: sales, error: salesError } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .in('shopId', shopIds)
      .gte('createdAt', startDate.toISOString());

    if (salesError) {
      logger.error('Mobile org dashboard query error', {
        userId: auth.payload.userId,
        error: salesError.message,
        endpoint: '/api/mobile/organization/dashboard',
      });
      return jsonResponse({ success: false, error: 'Failed to fetch dashboard data', code: 'INTERNAL_ERROR' }, 500);
    }

    const salesList = sales || [];

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

    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    salesList.forEach((sale: Record<string, unknown>) => {
      const productId = sale.productId as string;
      if (!productMap.has(productId)) {
        productMap.set(productId, { name: productNameMap.get(productId) || 'Unknown', quantity: 0, revenue: 0 });
      }
      const product = productMap.get(productId)!;
      product.quantity += (sale.quantity as number);
      product.revenue += (sale.totalAmount as number);
    });

    let topProduct = null;
    if (productMap.size > 0) {
      const topEntry = Array.from(productMap.entries()).reduce((a, b) => (a[1].revenue > b[1].revenue ? a : b));
      topProduct = topEntry[1];
    }

    const paymentMethodMap = new Map<string, number>();
    salesList.forEach((sale: Record<string, unknown>) => {
      const method = (sale.paymentMethod as string) || 'cash';
      paymentMethodMap.set(method, (paymentMethodMap.get(method) || 0) + 1);
    });
    const salesByPaymentMethod: Record<string, number> = {};
    paymentMethodMap.forEach((count, method) => {
      salesByPaymentMethod[method] = count;
    });

    const topProducts = Array.from(productMap.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([_, product]) => product);

    logger.info('Mobile org dashboard retrieved', {
      userId: auth.payload.userId,
      shopCount: shopIds.length,
      period,
      totalSales,
      endpoint: '/api/mobile/organization/dashboard',
    });

    return jsonResponse({
      success: true,
      data: {
        summary: {
          totalSales,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          averageTransactionValue: Math.round(averageTransactionValue * 100) / 100,
          topProduct,
        },
        metrics: { salesByPaymentMethod, topProducts },
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile org dashboard error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/organization/dashboard',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
