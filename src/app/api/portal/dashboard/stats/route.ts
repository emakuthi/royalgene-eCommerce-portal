import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { canViewCostData } from '@/lib/cost-visibility.server';

interface ProfitMarginRow {
  profit?: number;
  marginPercentage?: number;
}

interface SaleRecord {
  id?: string;
  saleGroupId?: string | null;
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
    const auth = requireTenantUser(request);
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
    // Rolling 30-day window (not calendar month) so recent sales always count —
    // a calendar month resets Revenue/Profit/Sales to 0 on the 1st even when
    // there was plenty of activity a few days earlier. (Field name kept as
    // monthStart to avoid churn; it now means "30 days ago".)
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get today's sales
    const { data: todaysSales } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .is('deletedAt', null)
      .gte('createdAt', todayStart.toISOString())
      .lt('createdAt', new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString());

    // Get this month's sales
    const { data: monthSales } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .is('deletedAt', null)
      .gte('createdAt', monthStart.toISOString())
      .lte('createdAt', now.toISOString());

    const todays: SaleRecord[] = Array.isArray(todaysSales) ? (todaysSales as unknown as SaleRecord[]) : [];
    const months: SaleRecord[] = Array.isArray(monthSales) ? (monthSales as unknown as SaleRecord[]) : [];

    // Calculate totals
    const salesToday = todays.reduce((sum: number, sale: SaleRecord) => sum + (Number((sale as { baseAmount?: number }).baseAmount ?? sale.totalAmount) || 0), 0);
    // Transactions = distinct checkouts (saleGroupId), not line items — same rule as the Android dashboard.
    const transactionsThisMonth = new Set(months.map((s) => s.saleGroupId || s.id)).size;
    const salesThisMonth = months.reduce((sum: number, sale: SaleRecord) => sum + (Number((sale as { baseAmount?: number }).baseAmount ?? sale.totalAmount) || 0), 0);

    // Gross profit from the per-sale cost SNAPSHOT (costPrice × qty), the same
    // rule analytics uses. The old ProfitMargin-join is never written to, so it
    // reported 0 profit regardless of actual sales.
    const lineProfit = (sale: SaleRecord): number => {
      const cost = (sale as { costPrice?: number | null }).costPrice;
      if (cost == null) return 0;
      const amt = Number((sale as { baseAmount?: number }).baseAmount ?? sale.totalAmount) || 0;
      return amt - cost * (Number(sale.quantity) || 0);
    };
    const profitThisMonth = months.reduce((sum, sale) => sum + lineProfit(sale), 0);
    const averageMargin = salesThisMonth > 0 ? (profitThisMonth / salesThisMonth) * 100 : 0;

    // Operating expenses over the same rolling 30-day window, this shop only.
    let expensesThisMonth = 0;
    if (payload.organizationId) {
      const { data: expenseRows } = await supabaseAdmin
        .from('Expense')
        .select('baseAmount')
        .eq('organizationId', payload.organizationId)
        .eq('shopId', shopId)
        .is('deletedAt', null)
        .gte('expenseDate', monthStart.toISOString().slice(0, 10))
        .lte('expenseDate', now.toISOString().slice(0, 10));
      expensesThisMonth = ((expenseRows as { baseAmount: number }[]) ?? []).reduce(
        (sum, e) => sum + (Number(e.baseAmount) || 0),
        0,
      );
    }
    const netProfitThisMonth = profitThisMonth - expensesThisMonth;

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
        existing.sales += Number((sale as { baseAmount?: number }).baseAmount ?? sale.totalAmount) || 0;
      } else {
        productSalesMap.set(pid, {
          name: '',
          quantity: sale.quantity || 0,
          sales: Number((sale as { baseAmount?: number }).baseAmount ?? sale.totalAmount) || 0,
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

    // Cost/profit are owner-only (see cost-visibility.server.ts).
    const showCost = await canViewCostData(payload);

    return jsonResponse({ success: true, data: { totalSales: salesThisMonth, totalProfit: showCost ? profitThisMonth : null, averageMargin: showCost ? averageMargin : null, totalExpenses: showCost ? expensesThisMonth : null, netProfit: showCost ? netProfitThisMonth : null, lowStockProducts: lowStockItems.length, topSellingProducts, salesToday, salesThisMonth, transactionsThisMonth } }, 200);
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
