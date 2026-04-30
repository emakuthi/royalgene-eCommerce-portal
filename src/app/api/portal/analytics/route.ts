import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';

// Define typed shapes we expect from Supabase queries
interface ProfitMarginRow {
  profit?: number;
  marginPercentage?: number;
}

interface SaleRecord {
  id?: string;
  productId: string;
  quantity: number;
  totalAmount: number;
  createdAt: string;
  ProfitMargin?: ProfitMarginRow | ProfitMarginRow[];
}

interface ProductRow {
  id: string;
  name?: string | null;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      logger.warn('Analytics unauthorized: no token', { endpoint: '/api/portal/analytics', method: 'GET' });
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      logger.warn('Analytics unauthorized: invalid token', { endpoint: '/api/portal/analytics' });
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const range = searchParams.get('range') || 'month';

    logger.info('Fetching analytics', { shopId, range, userId: payload.userId, endpoint: '/api/portal/analytics' });

    if (!shopId) {
      logger.warn('Analytics failed: shop ID required', { endpoint: '/api/portal/analytics' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // Calculate date range
    const now = new Date();
    const startDate = new Date();

    if (range === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else if (range === 'month') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (range === 'year') {
      startDate.setFullYear(now.getFullYear() - 1);
    }

    // Get sales entries in range
    const { data: sales, error: salesError } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .gte('createdAt', startDate.toISOString())
      .lte('createdAt', now.toISOString());

    if (salesError) {
      logger.error('Portal analytics: supabase sales query failed', { error: salesError.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to fetch sales' }, 500);
    }

    // Calculate summary
    let totalSales = 0;
    let totalProfit = 0;
    let marginSum = 0;
    const productMap = new Map<string, { name: string; quantity: number; sales: number; profit: number }>();

    const salesList: SaleRecord[] = Array.isArray(sales) ? (sales as unknown as SaleRecord[]) : [];

    salesList.forEach((sale) => {
      const amt = Number(sale.totalAmount) || 0;
      totalSales += amt;

      const profitMarginData = Array.isArray(sale.ProfitMargin) ? sale.ProfitMargin[0] as ProfitMarginRow : sale.ProfitMargin as ProfitMarginRow | undefined;
      if (profitMarginData) {
        totalProfit += profitMarginData.profit || 0;
        marginSum += profitMarginData.marginPercentage || 0;
      }

      const pid = String(sale.productId || '');
      const existing = productMap.get(pid);
      if (existing) {
        existing.quantity += sale.quantity || 0;
        existing.sales += amt;
        if (profitMarginData) {
          existing.profit += profitMarginData.profit || 0;
        }
      } else {
        productMap.set(pid, {
          name: `Product ${pid}`,
          quantity: sale.quantity || 0,
          sales: amt,
          profit: profitMarginData?.profit || 0,
        });
      }
    });

    // Get product names AND cost prices
    const productIds = Array.from(productMap.keys()).filter(Boolean);
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from('Product')
        .select('id, name, costPrice')
        .in('id', productIds);

      const productRows: ProductRow[] = Array.isArray(products) ? (products as unknown as ProductRow[]) : [];
      productRows.forEach((product) => {
        const data = productMap.get(product.id);
        if (data) {
          data.name = product.name || data.name;
        }
      });
    }

    // Sort products by sales
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    // Group sales by date
    const dateMap = new Map<string, { date: string; sales: number; transactions: number; profit: number }>();

    salesList.forEach((sale) => {
      const dateStr = (sale.createdAt || '').split('T')[0] || new Date().toISOString().split('T')[0];
      const existing = dateMap.get(dateStr);

      const profitMarginData = Array.isArray(sale.ProfitMargin) ? sale.ProfitMargin[0] as ProfitMarginRow : sale.ProfitMargin as ProfitMarginRow | undefined;

      if (existing) {
        existing.sales += Number(sale.totalAmount) || 0;
        existing.transactions += 1;
        if (profitMarginData) {
          existing.profit += profitMarginData.profit || 0;
        }
      } else {
        dateMap.set(dateStr, {
          date: dateStr,
          sales: Number(sale.totalAmount) || 0,
          transactions: 1,
          profit: profitMarginData?.profit || 0,
        });
      }
    });

    const salesData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const avgMargin = salesList.length > 0 ? marginSum / salesList.length : 0;

    logger.info('Analytics fetched successfully', {
      shopId,
      range,
      userId: payload.userId,
      endpoint: '/api/portal/analytics',
      duration: Date.now() - startTime
    });

    return jsonResponse({ success: true, data: { summary: { totalSales, totalProfit, avgMargin, totalTransactions: salesList.length }, salesData, topProducts } }, 200);
  } catch (error) {
    logger.error('Analytics error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/analytics',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}
