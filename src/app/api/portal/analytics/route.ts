import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { canViewCostData } from '@/lib/cost-visibility.server';

interface SaleRecord {
  id?: string;
  productId: string;
  quantity: number;
  totalAmount: number;
  /** Snapshot of the product's cost price AT THE TIME OF THIS SALE — see SalesEntry migration 20260920_02. Null for a sale recorded before that column existed. */
  costPrice?: number | null;
  createdAt: string;
}

interface ProductRow {
  id: string;
  name?: string | null;
}

/**
 * Profit for one sale line: `totalAmount - costPrice × quantity`, using the cost
 * SNAPSHOT taken at sale time (never the product's current cost, which can drift
 * after the sale) — same rule Android's ProfitCalculator.lineProfit applies. A
 * line with no snapshot yet contributes 0 rather than being excluded, so it's an
 * undercount that self-corrects as older data ages out, not a blocking error.
 *
 * This REPLACES an earlier version of this route that joined a `ProfitMargin`
 * table for profit — that table is never written to anywhere in the app, so
 * every sale's contribution was silently 0 regardless of shop or date range.
 */
function lineProfit(sale: SaleRecord): number {
  const cost = sale.costPrice;
  if (cost == null) return 0;
  return (Number(sale.totalAmount) || 0) - cost * (Number(sale.quantity) || 0);
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const { searchParams } = new URL(request.url);
    const requestedShopId = searchParams.get('shopId');
    const range = searchParams.get('range') || 'month';
    const isAdmin = payload.role === 'admin' || payload.role === 'super_admin';

    // A specific shop is always required for a non-admin (their own single
    // shop). An admin may omit it to mean "every shop in my org" — the
    // portal's shop switcher's "All Shops" option, previously left
    // completely unimplemented here: the page just showed an empty state
    // for that choice, however the date-range filter was set.
    let shopIds: string[];
    if (requestedShopId) {
      // Verify the requested shop belongs to the caller's own organization
      // before returning any figures for it (super_admin exempt).
      if (payload.organizationId) {
        const { data: shopCheck } = await supabaseAdmin
          .from('Shop')
          .select('id')
          .eq('id', requestedShopId)
          .eq('organizationId', payload.organizationId)
          .maybeSingle();
        if (!shopCheck) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
      shopIds = [requestedShopId];
    } else if (isAdmin && payload.organizationId) {
      const { data: orgShops, error: orgShopsError } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('organizationId', payload.organizationId)
        .eq('isActive', true);
      if (orgShopsError) {
        logger.error('Portal analytics: failed to resolve org shops', { error: orgShopsError.message, organizationId: payload.organizationId });
        return jsonResponse({ success: false, error: 'Failed to fetch analytics' }, 500);
      }
      shopIds = (orgShops ?? []).map((s: { id: string }) => s.id);
    } else {
      logger.warn('Analytics failed: shop ID required', { endpoint: '/api/portal/analytics' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    if (payload.organizationId) {
      const featureResponse = await assertFeatureEnabled(payload.organizationId, FeatureCode.ADVANCED_ANALYTICS);
      if (featureResponse) return featureResponse;
    }

    if (shopIds.length === 0) {
      // An org with no active shops yet — a real, empty result, not an error.
      return jsonResponse({ success: true, data: { summary: { totalSales: 0, totalProfit: 0, avgMargin: 0, totalTransactions: 0 }, salesData: [], topProducts: [] } }, 200);
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
      .select('id, productId, quantity, totalAmount, costPrice, createdAt')
      .in('shopId', shopIds)
      .is('deletedAt', null)
      .gte('createdAt', startDate.toISOString())
      .lte('createdAt', now.toISOString());

    if (salesError) {
      logger.error('Portal analytics: supabase sales query failed', { error: salesError.message, shopIds });
      return jsonResponse({ success: false, error: 'Failed to fetch sales' }, 500);
    }

    // Calculate summary
    let totalSales = 0;
    let totalProfit = 0;
    const productMap = new Map<string, { name: string; quantity: number; sales: number; profit: number }>();

    const salesList: SaleRecord[] = Array.isArray(sales) ? (sales as unknown as SaleRecord[]) : [];

    salesList.forEach((sale) => {
      const amt = Number(sale.totalAmount) || 0;
      const profit = lineProfit(sale);
      totalSales += amt;
      totalProfit += profit;

      const pid = String(sale.productId || '');
      const existing = productMap.get(pid);
      if (existing) {
        existing.quantity += sale.quantity || 0;
        existing.sales += amt;
        existing.profit += profit;
      } else {
        productMap.set(pid, { name: `Product ${pid}`, quantity: sale.quantity || 0, sales: amt, profit });
      }
    });

    // Get product names
    const productIds = Array.from(productMap.keys()).filter(Boolean);
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from('Product')
        .select('id, name')
        .in('id', productIds);

      const productRows: ProductRow[] = Array.isArray(products) ? (products as unknown as ProductRow[]) : [];
      productRows.forEach((product) => {
        const data = productMap.get(product.id);
        if (data) data.name = product.name || data.name;
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
      const profit = lineProfit(sale);
      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.sales += Number(sale.totalAmount) || 0;
        existing.transactions += 1;
        existing.profit += profit;
      } else {
        dateMap.set(dateStr, { date: dateStr, sales: Number(sale.totalAmount) || 0, transactions: 1, profit });
      }
    });

    const salesData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const avgMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

    logger.info('Analytics fetched successfully', {
      shopIds,
      range,
      userId: payload.userId,
      endpoint: '/api/portal/analytics',
      duration: Date.now() - startTime
    });

    // Cost/profit are owner-only (see cost-visibility.server.ts): blank the
    // totals and strip the per-point/per-product profit for everyone else.
    const showCost = await canViewCostData(payload);
    const gatedSalesData = showCost ? salesData : salesData.map(({ profit: _p, ...rest }) => rest);
    const gatedTopProducts = showCost ? topProducts : topProducts.map(({ profit: _p, ...rest }) => rest);

    return jsonResponse({ success: true, data: { summary: { totalSales, totalProfit: showCost ? totalProfit : null, avgMargin: showCost ? avgMargin : null, totalTransactions: salesList.length }, salesData: gatedSalesData, topProducts: gatedTopProducts } }, 200);
  } catch (error) {
    logger.error('Analytics error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/analytics',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}
