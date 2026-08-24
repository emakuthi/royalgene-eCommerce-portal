import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { getOrgShopIds } from '@/lib/mobile-org-shops';

/**
 * GET /api/mobile/organization/sales-history
 * "All Shops" sales history for admins — same shape and query params as
 * GET /api/mobile/shops/[shopId]/sales-history, aggregated (and paginated
 * server-side, not merged client-side) across every shop in the caller's
 * org. Each entry additionally carries `shop` since results now span
 * multiple shops — the single-shop endpoint's caller already knows which
 * shop it asked for, so it doesn't need this field.
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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const shopIds = await getOrgShopIds(auth.payload.organizationId ?? null);

    if (shopIds.length === 0) {
      return jsonResponse({
        success: true,
        data: {
          sales: [],
          pagination: { page, limit, total: 0, pages: 0 },
          summary: { totalSales: 0, totalAmount: 0, totalProfit: 0 },
        },
      }, 200);
    }

    let query = supabaseAdmin
      .from('SalesEntry')
      .select('*', { count: 'exact' })
      .in('shopId', shopIds)
      .order('createdAt', { ascending: false });

    if (startDate) query = query.gte('createdAt', startDate);
    if (endDate) query = query.lte('createdAt', endDate);

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: sales, error: salesError, count } = await query;

    if (salesError) {
      logger.error('Mobile org sales history query error', {
        userId: auth.payload.userId,
        error: salesError.message,
        endpoint: '/api/mobile/organization/sales-history',
      });
      return jsonResponse({ success: false, error: 'Failed to fetch sales', code: 'INTERNAL_ERROR' }, 500);
    }

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

    const shopNameMap = new Map<string, string>();
    const { data: shopRows } = await supabaseAdmin.from('Shop').select('id, name').in('id', shopIds);
    for (const s of (shopRows || []) as { id: string; name: string }[]) {
      shopNameMap.set(s.id, s.name);
    }

    const totalSales = count || 0;
    const totalAmount = (sales || []).reduce((sum: number, sale: Record<string, unknown>) => sum + ((sale.totalAmount as number) || 0), 0);
    const totalProfit = (sales || []).reduce((sum: number, sale: Record<string, unknown>) => {
      const profit = ((sale.totalAmount as number) || 0) - (((sale.costPrice as number) || 0) * ((sale.quantity as number) || 0));
      return sum + profit;
    }, 0);

    const salesList = (sales || []).map((sale: Record<string, unknown>) => {
      const product = productMap.get(sale.productId as string);
      const shopId = sale.shopId as string;
      return {
        saleId: sale.id,
        saleNumber: `SALE-${new Date(sale.createdAt as string).toISOString().split('T')[0].replace(/-/g, '')}-${(sale.id as string).substring(0, 6).toUpperCase()}`,
        timestamp: sale.createdAt,
        shop: { id: shopId, name: shopNameMap.get(shopId) ?? null },
        product: { name: product?.name ?? null, sku: product?.sku ?? null },
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
        customerName: sale.customerName,
      };
    });

    const total = count || 0;
    const pages = Math.ceil(total / limit);

    logger.info('Mobile org sales history retrieved', {
      userId: auth.payload.userId,
      shopCount: shopIds.length,
      salesCount: salesList.length,
      endpoint: '/api/mobile/organization/sales-history',
    });

    return jsonResponse({
      success: true,
      data: {
        sales: salesList,
        pagination: { page, limit, total, pages },
        summary: { totalSales, totalAmount, totalProfit: Math.round(totalProfit * 100) / 100 },
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile org sales history error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/organization/sales-history',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
