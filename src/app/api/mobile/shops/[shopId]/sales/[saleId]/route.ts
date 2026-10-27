import { applySaleEdit, canEditSale, NOT_YOUR_SALE } from '@/lib/sale-edit.server';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { canViewCostData } from '@/lib/cost-visibility.server';
import { deleteSalesInOrg } from '@/lib/sale-delete.server';
import { businessDateKey } from '@/lib/business-time';

/**
 * GET /api/mobile/shops/[shopId]/sales/[saleId]
 * Get details of a specific sale
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; saleId: string }> }
) {
  try {
    const { shopId, saleId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    // Get sale details
    const { data: sale, error: saleError } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('id', saleId)
      .eq('shopId', shopId)
      .is('deletedAt', null)
      .single();

    if (saleError || !sale) {
      logger.warn('Mobile sale not found', { 
        userId: auth.payload.userId,
        shopId,
        saleId,
        endpoint: `/api/mobile/shops/${shopId}/sales/${saleId}`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Sale not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // Fetch shop name — for the receipt header.
    let shopName: string | null = null;
    {
      const { data: shopRow } = await supabaseAdmin.from('Shop').select('name').eq('id', shopId).maybeSingle();
      shopName = (shopRow as { name?: string } | null)?.name ?? null;
    }

    // Fetch related product
    let productInfo: { id: string; name: string; sku: string; category: string } | null = null;
    if (sale.productId) {
      const { data: prod } = await supabaseAdmin
        .from('Product')
        .select('id, name, sku, category')
        .eq('id', sale.productId)
        .single();
      if (prod) {
        const p = prod as Record<string, unknown>;
        productInfo = {
          id: p.id as string,
          name: p.name as string,
          sku: p.sku as string,
          category: p.category as string,
        };
      }
    }

    // Fetch recorded-by user name
    let recordedByName: string | null = null;
    if (sale.portalUserId) {
      const { data: pu } = await supabaseAdmin
        .from('PortalUser')
        .select('userId')
        .eq('id', sale.portalUserId)
        .single();
      const puRec = pu as Record<string, unknown> | null;
      if (puRec?.userId) {
        const { data: usr } = await supabaseAdmin
          .from('User')
          .select('name')
          .eq('id', puRec.userId as string)
          .single();
        const usrRec = usr as Record<string, unknown> | null;
        recordedByName = (usrRec?.name as string) ?? null;
      }
    }

    // Cost/profit are owner-only (see cost-visibility.server.ts).
    const showCost = await canViewCostData(auth.payload);
    const costPrice = sale.costPrice || 0;
    const profit = sale.totalAmount - (costPrice * sale.quantity);
    const marginPercentage = sale.totalAmount > 0 ? (profit / sale.totalAmount) * 100 : 0;

    logger.info('Mobile sale details retrieved', { 
      userId: auth.payload.userId,
      shopId,
      saleId,
      endpoint: `/api/mobile/shops/${shopId}/sales/${saleId}`
    });

    return jsonResponse({
      success: true,
      data: {
        sale: {
          saleId: sale.id,
          saleNumber: `SALE-${businessDateKey(sale.createdAt).replace(/-/g, '')}-${sale.id.substring(0, 6).toUpperCase()}`,
          timestamp: sale.createdAt,
          shopId: sale.shopId,
          shopName,
          product: {
            id: productInfo?.id ?? null,
            name: productInfo?.name ?? null,
            sku: productInfo?.sku ?? null,
            category: productInfo?.category ?? null
          },
          quantity: sale.quantity,
          unitPrice: sale.unitPrice,
          totalAmount: sale.totalAmount,
          costPrice: showCost ? costPrice : null,
          profit: showCost ? Math.round(profit * 100) / 100 : null,
          marginPercentage: showCost ? Math.round(marginPercentage * 100) / 100 : null,
          paymentMethod: sale.paymentMethod,
          paymentBreakdown: sale.paymentBreakdown ?? null,
          customerName: sale.customerName,
          customerPhone: sale.customerPhone,
          notes: sale.notes,
          recordedBy: recordedByName,
          canEdit: await canEditSale(auth.payload, sale),
          updatedAt: sale.updatedAt
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile sale details error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/sales/[saleId]'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * PATCH /api/mobile/shops/[shopId]/sales/[saleId]
 * Update an existing sale entry
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; saleId: string }> }
) {
  try {
    const { shopId, saleId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    // Fetch existing sale
    const { data: existingSale, error: saleErr } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('id', saleId)
      .eq('shopId', shopId)
      .is('deletedAt', null)
      .single();

    if (saleErr || !existingSale) {
      return jsonResponse({ success: false, error: 'Sale not found', code: 'NOT_FOUND' }, 404);
    }

    if (!(await canEditSale(auth.payload, existingSale))) {
      return jsonResponse({ success: false, error: NOT_YOUR_SALE, code: 'FORBIDDEN' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const result = await applySaleEdit(existingSale, body, auth.portalUserId ?? null);
    if (!result.ok) return jsonResponse({ success: false, error: result.error, code: result.code }, result.status);
    const updatedSale = result.sale;

    logger.info('Mobile sale updated', {
      userId: auth.payload.userId,
      shopId,
      saleId,
      endpoint: `/api/mobile/shops/${shopId}/sales/${saleId}`,
    });

    return jsonResponse({ success: true, data: updatedSale }, 200);
  } catch (error) {
    logger.error('Mobile sale update error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/sales/[saleId]',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

/**
 * DELETE /api/mobile/shops/[shopId]/sales/[saleId]
 * Delete one sale line item — admins only. See POST /api/mobile/sales/bulk-delete
 * for the multi-select form (this is just that with a single id).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; saleId: string }> }
) {
  try {
    const { shopId, saleId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    if (!auth.isAdmin) {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete sales.', code: 'FORBIDDEN' }, 403);
    }
    if (!auth.payload.organizationId) {
      return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
    }

    const outcome = await deleteSalesInOrg(auth.payload.organizationId, [saleId], auth.portalUserId);

    if (outcome.notFound.length > 0) {
      return jsonResponse({ success: false, error: 'Sale not found', code: 'NOT_FOUND' }, 404);
    }
    if (outcome.failed.length > 0) {
      return jsonResponse({ success: false, error: outcome.failed[0].error || 'Failed to delete sale', code: 'INTERNAL_ERROR' }, 500);
    }

    logger.info('Mobile sale deleted', { userId: auth.payload.userId, shopId, saleId });
    return jsonResponse({ success: true, message: 'Sale deleted' }, 200);
  } catch (error) {
    logger.error('Mobile sale delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(_request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

