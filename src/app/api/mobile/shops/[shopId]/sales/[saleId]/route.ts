import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

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
          saleNumber: `SALE-${new Date(sale.createdAt).toISOString().split('T')[0].replace(/-/g, '')}-${sale.id.substring(0, 6).toUpperCase()}`,
          timestamp: sale.createdAt,
          shopId: sale.shopId,
          product: {
            id: productInfo?.id ?? null,
            name: productInfo?.name ?? null,
            sku: productInfo?.sku ?? null,
            category: productInfo?.category ?? null
          },
          quantity: sale.quantity,
          unitPrice: sale.unitPrice,
          totalAmount: sale.totalAmount,
          costPrice,
          profit: Math.round(profit * 100) / 100,
          marginPercentage: Math.round(marginPercentage * 100) / 100,
          paymentMethod: sale.paymentMethod,
          customerName: sale.customerName,
          customerPhone: sale.customerPhone,
          notes: sale.notes,
          recordedBy: recordedByName,
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
      .single();

    if (saleErr || !existingSale) {
      return jsonResponse({ success: false, error: 'Sale not found', code: 'NOT_FOUND' }, 404);
    }

    const body = await request.json();
    const { quantity, unitPrice, paymentMethod, customerName, customerPhone, notes } = body;

    type UpdatePayload = Partial<{
      quantity: number;
      unitPrice: number;
      paymentMethod: string;
      customerName: string | null;
      customerPhone: string | null;
      notes: string | null;
      totalAmount: number;
      updatedAt: string;
    }>;

    const updates: UpdatePayload = {};
    if (typeof quantity === 'number') updates.quantity = quantity;
    if (typeof unitPrice === 'number') updates.unitPrice = unitPrice;
    if (paymentMethod) updates.paymentMethod = paymentMethod;
    if (typeof customerName !== 'undefined') updates.customerName = customerName;
    if (typeof customerPhone !== 'undefined') updates.customerPhone = customerPhone;
    if (typeof notes !== 'undefined') updates.notes = notes;

    // Recompute totalAmount
    const newQuantity = typeof updates.quantity === 'number' ? updates.quantity : existingSale.quantity;
    const newUnitPrice = typeof updates.unitPrice === 'number' ? updates.unitPrice : existingSale.unitPrice;
    updates.totalAmount = newQuantity * newUnitPrice;
    updates.updatedAt = new Date().toISOString();

    const { data: updatedSale, error: updateErr } = await supabaseAdmin
      .from('SalesEntry')
      .update(updates)
      .eq('id', saleId)
      .select()
      .single();

    if (updateErr) {
      logger.error('Mobile sale update failed', { error: updateErr.message, saleId, shopId });
      return jsonResponse({ success: false, error: 'Failed to update sale', code: 'INTERNAL_ERROR' }, 500);
    }

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
 * OPTIONS handler for CORS
 */
export async function OPTIONS(_request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

