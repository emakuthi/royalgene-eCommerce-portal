/**
 * POST /api/portal/stock/transfer
 * Send stock units of a product from one shop to another. The receiving
 * shop has to approve it before the stock lands there; until then it's held
 * at the source (see transfer-approval.server.ts).
 *
 * Request body:
 *   fromShopStockId – ShopStock.id of the source row
 *   toShopId        – destination Shop.id
 *   quantity        – number of units to transfer (must be > 0 and <= source quantity)
 *   variants?       – [{ size, color, quantity }] when the product is tracked by size/colour
 *   notes?          – optional reason / notes for the transfer
 *
 * Auth:
 *   • admin / super_admin → can transfer between any shops
 *   • portal_user          → can only transfer FROM their own shop
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { prepareSend, sendTransfer } from '@/lib/transfer-approval.server';
import { portalUserIdFor, canActForShop } from '@/lib/portal-transfer-access.server';

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const body = await request.json() as {
      fromShopStockId?: string;
      toShopId?: string;
      quantity?: number;
      variants?: unknown;
      notes?: string;
    };
    const { fromShopStockId, toShopId, notes } = body;
    if (!fromShopStockId || !toShopId || (body.quantity == null && body.variants == null)) {
      return jsonResponse({ success: false, error: 'fromShopStockId, toShopId, and quantity are required' }, 400);
    }

    const { data: src } = await supabaseAdmin
      .from('ShopStock')
      .select('id, shopId, productId, organizationId')
      .eq('id', fromShopStockId)
      .maybeSingle();
    if (!src) {
      logger.warn('Stock transfer: source ShopStock not found', { fromShopStockId, userId: payload.userId });
      return jsonResponse({ success: false, error: 'Source stock not found' }, 404);
    }
    // Even an "admin" is org-scoped (true super_admin exempt).
    if (payload.organizationId && src.organizationId !== payload.organizationId) {
      logger.warn('Stock transfer forbidden: source stock not in caller organization', { userId: payload.userId, fromShopStockId });
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }
    if (!(await canActForShop(payload, src.shopId as string))) {
      logger.warn('Stock transfer forbidden: user not assigned to source shop', { userId: payload.userId, sourceShopId: src.shopId });
      return jsonResponse({ success: false, error: 'Forbidden: you can only transfer from your own shop' }, 403);
    }

    const prep = await prepareSend({ fromShopId: src.shopId as string, productId: src.id, toShopId });
    if (!prep.ok) {
      if ('response' in prep) return prep.response;
      return jsonResponse({ success: false, error: prep.error, code: prep.code }, prep.status);
    }

    const sent = await sendTransfer({
      organizationId: prep.organizationId,
      srcStock: prep.srcStock,
      fromShopId: src.shopId as string,
      toShop: prep.toShop,
      quantity: body.quantity,
      variants: body.variants,
      notes: notes ?? null,
      portalUserId: await portalUserIdFor(payload, src.shopId as string),
    });
    if (!sent.ok) return jsonResponse({ success: false, error: sent.error, code: sent.code }, sent.status);

    const { data: after } = await supabaseAdmin.from('ShopStock').select('quantity').eq('id', src.id).maybeSingle();
    void trackFromRequest(request, payload, {
      action: 'stock.transfer',
      category: 'stock',
      resourceType: 'ShopStock',
      resourceId: fromShopStockId,
      shopId: src.shopId as string,
      details: {
        fromShopId: src.shopId, toShopId, toShopName: prep.toShop.name, productId: src.productId,
        quantity: sent.transfer.quantity, notes, transferId: sent.transfer.id, status: 'pending',
      },
    });

    return jsonResponse({
      success: true,
      message: `${sent.transfer.quantity} unit(s) sent to ${prep.toShop.name} — they'll be added there once ${prep.toShop.name} approves.`,
      data: {
        transferId: sent.transfer.id,
        status: sent.transfer.status,
        fromShopStockId,
        toShopId,
        toShopName: prep.toShop.name,
        productId: src.productId,
        quantity: sent.transfer.quantity,
        newSourceQuantity: Number(after?.quantity ?? 0),
      },
    }, 200);
  } catch (error) {
    logger.error('Stock transfer error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/stock/transfer',
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
