/**
 * POST /api/mobile/shops/[shopId]/stock/transfer
 * Mobile endpoint — transfer stock of a product from [shopId] to another shop.
 *
 * Request body:
 *   productId  – Product.id (or ShopStock.id) to transfer from [shopId]
 *   toShopId   – destination Shop.id
 *   quantity   – number of units to transfer (> 0 and <= source quantity)
 *   notes?     – optional reason / notes
 *
 * Auth: verifyMobileShopAccess (portal_user must own the source shop; admins are bypassed)
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { v4 as uuidv4 } from 'uuid';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const body = await request.json() as {
      productId?: string;
      toShopId?: string;
      quantity?: number;
      notes?: string;
    };

    const { productId, toShopId, quantity, notes } = body;

    if (!productId || !toShopId || quantity == null) {
      return jsonResponse(
        { success: false, error: 'productId, toShopId, and quantity are required', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    const transferQty = Number(quantity);
    if (!Number.isFinite(transferQty) || transferQty <= 0) {
      return jsonResponse(
        { success: false, error: 'quantity must be a positive number', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    if (shopId === toShopId) {
      return jsonResponse(
        { success: false, error: 'Source and destination shops must be different', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    // Resolve source ShopStock — accept either Product.id or ShopStock.id
    let { data: srcStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, shopId, productId, quantity, lowStockThreshold')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .maybeSingle();

    if (!srcStock) {
      const fallback = await supabaseAdmin
        .from('ShopStock')
        .select('id, shopId, productId, quantity, lowStockThreshold')
        .eq('shopId', shopId)
        .eq('id', productId)
        .maybeSingle();
      if (fallback.data) srcStock = fallback.data;
    }

    if (!srcStock) {
      logger.warn('Mobile stock transfer: source ShopStock not found', { shopId, productId, userId: auth.payload.userId });
      return jsonResponse({ success: false, error: 'Product not found in source shop', code: 'NOT_FOUND' }, 404);
    }

    if ((srcStock.quantity as number) < transferQty) {
      return jsonResponse(
        { success: false, error: `Insufficient stock. Available: ${srcStock.quantity}, requested: ${transferQty}`, code: 'INSUFFICIENT_STOCK' },
        400,
      );
    }

    // Verify destination shop
    const { data: destShop } = await supabaseAdmin
      .from('Shop')
      .select('id, name')
      .eq('id', toShopId)
      .maybeSingle();

    if (!destShop) {
      return jsonResponse({ success: false, error: 'Destination shop not found', code: 'NOT_FOUND' }, 404);
    }

    const resolvedProductId = srcStock.productId as string;
    const now = new Date().toISOString();
    const portalUserId = auth.isAdmin
      ? `admin-${auth.payload.userId}`
      : auth.portalUserId;

    // Decrement source
    const newSrcQty = (srcStock.quantity as number) - transferQty;
    const { error: srcUpdateErr } = await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: newSrcQty, updatedAt: now })
      .eq('id', srcStock.id);

    if (srcUpdateErr) {
      logger.error('Mobile stock transfer: failed to decrement source', { error: srcUpdateErr.message, shopStockId: srcStock.id });
      return jsonResponse({ success: false, error: 'Failed to update source stock', code: 'INTERNAL_ERROR' }, 500);
    }

    // Increment or create destination ShopStock
    const { data: destStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, quantity')
      .eq('shopId', toShopId)
      .eq('productId', resolvedProductId)
      .maybeSingle();

    let destStockId: string;
    if (destStock) {
      await supabaseAdmin
        .from('ShopStock')
        .update({ quantity: (destStock.quantity as number) + transferQty, updatedAt: now })
        .eq('id', destStock.id);
      destStockId = destStock.id as string;
    } else {
      destStockId = uuidv4();
      await supabaseAdmin.from('ShopStock').insert([{
        id: destStockId,
        shopId: toShopId,
        productId: resolvedProductId,
        quantity: transferQty,
        lowStockThreshold: srcStock.lowStockThreshold ?? 5,
        createdAt: now,
        updatedAt: now,
      }]);
    }

    // StockTransaction records
    await supabaseAdmin.from('StockTransaction').insert([
      {
        id: uuidv4(),
        shopStockId: srcStock.id,
        portalUserId,
        type: 'subtract',
        quantity: -transferQty,
        reason: `Mobile transfer out to ${destShop.name}${notes ? ` — ${notes}` : ''}`,
        reference: `mobile-transfer-${now}`,
        createdAt: now,
      },
      {
        id: uuidv4(),
        shopStockId: destStockId,
        portalUserId,
        type: 'add',
        quantity: transferQty,
        reason: `Mobile transfer in from shop ${shopId}${notes ? ` — ${notes}` : ''}`,
        reference: `mobile-transfer-${now}`,
        createdAt: now,
      },
    ]);

    // Sync aggregated product stock
    try {
      await syncProductStockFromShopStocks(resolvedProductId);
    } catch (syncErr) {
      logger.warn('Mobile stock transfer: failed to sync product stockQuantity', {
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
        productId: resolvedProductId,
      });
    }

    logger.info('Mobile stock transfer completed', {
      userId: auth.payload.userId,
      fromShopId: shopId,
      toShopId,
      productId: resolvedProductId,
      quantity: transferQty,
    });

    return jsonResponse({
      success: true,
      message: `${transferQty} unit(s) transferred to ${destShop.name}`,
      data: {
        fromShopId: shopId,
        toShopId,
        toShopName: destShop.name,
        productId: resolvedProductId,
        quantity: transferQty,
        newSourceQuantity: newSrcQty,
      },
    }, 200);

  } catch (error) {
    logger.error('Mobile stock transfer error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/stock/transfer',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

