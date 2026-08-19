import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

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

interface StockItem {
  id?: string;
  productId?: string;
  shopId?: string;
  quantity?: number;
  lowStockThreshold?: number;
}

interface ProductRow {
  id: string;
  name?: string | null;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    logger.info('Fetching dashboard stats', { shopId, userId: payload.userId, endpoint: '/api/portal/dashboard/stats' });

    if (!shopId) {
      logger.warn('Dashboard stats failed: shop ID required', { endpoint: '/api/portal/dashboard/stats' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // Verify the requested shop belongs to the caller's own organization
    // before returning any figures for it (super_admin exempt).
    if (payload.organizationId) {
      const { data: shopCheck } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('id', shopId)
        .eq('organizationId', payload.organizationId)
        .maybeSingle();
      if (!shopCheck) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Get current date and calculate date ranges
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get today's sales
    const { data: todaysSales } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .gte('createdAt', todayStart.toISOString())
      .lt('createdAt', new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString());

    // Get this month's sales
    const { data: monthSales } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .gte('createdAt', monthStart.toISOString())
      .lte('createdAt', now.toISOString());

    const todays: SaleRecord[] = Array.isArray(todaysSales) ? (todaysSales as unknown as SaleRecord[]) : [];
    const months: SaleRecord[] = Array.isArray(monthSales) ? (monthSales as unknown as SaleRecord[]) : [];

    // Calculate totals
    const salesToday = todays.reduce((sum: number, sale: SaleRecord) => sum + (Number(sale.totalAmount) || 0), 0);
    const salesThisMonth = months.reduce((sum: number, sale: SaleRecord) => sum + (Number(sale.totalAmount) || 0), 0);

    const profitThisMonth = months.reduce((sum: number, sale: SaleRecord) => {
      const profitData = Array.isArray(sale.ProfitMargin) ? sale.ProfitMargin[0] as ProfitMarginRow : sale.ProfitMargin as ProfitMarginRow | undefined;
      return sum + (profitData?.profit || 0);
    }, 0);

    const marginSum = months.reduce((sum: number, sale: SaleRecord) => {
      const profitData = Array.isArray(sale.ProfitMargin) ? sale.ProfitMargin[0] as ProfitMarginRow : sale.ProfitMargin as ProfitMarginRow | undefined;
      return sum + (profitData?.marginPercentage || 0);
    }, 0);
    const averageMargin = months.length > 0 ? marginSum / months.length : 0;

    // Get low stock items
    const { data: allStockItems } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('shopId', shopId);

    const stockItems: StockItem[] = Array.isArray(allStockItems) ? (allStockItems as unknown as StockItem[]) : [];
    const lowStockItems = stockItems.filter((item: StockItem) => (item.quantity || 0) <= (item.lowStockThreshold || 0));

    // Get top-selling products this month
    const productSalesMap = new Map<string, { name: string; quantity: number; sales: number }>();

    months.forEach((sale: SaleRecord) => {
      const pid = String(sale.productId || '');
      const existing = productSalesMap.get(pid);
      if (existing) {
        existing.quantity += sale.quantity || 0;
        existing.sales += Number(sale.totalAmount) || 0;
      } else {
        productSalesMap.set(pid, {
          name: '',
          quantity: sale.quantity || 0,
          sales: Number(sale.totalAmount) || 0,
        });
      }
    });

    // Get product names
    const productIds = Array.from(productSalesMap.keys()).filter(Boolean);
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from('Product')
        .select('id, name')
        .in('id', productIds);

      const productRows: ProductRow[] = Array.isArray(products) ? (products as unknown as ProductRow[]) : [];
      productRows.forEach(product => {
        const data = productSalesMap.get(product.id);
        if (data) {
          data.name = product.name || data.name;
        }
      });
    }

    const topSellingProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    logger.info('Dashboard stats fetched successfully', {
      shopId,
      userId: payload.userId,
      endpoint: '/api/portal/dashboard/stats',
      duration: Date.now() - startTime
    });

    return jsonResponse({ success: true, data: { totalSales: salesThisMonth, totalProfit: profitThisMonth, averageMargin, lowStockProducts: lowStockItems.length, topSellingProducts, salesToday, salesThisMonth } }, 200);
  } catch (error) {
    logger.error('Dashboard stats error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/dashboard/stats',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
