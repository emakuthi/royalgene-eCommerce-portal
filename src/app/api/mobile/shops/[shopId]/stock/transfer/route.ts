/**
 * POST /api/mobile/shops/[shopId]/stock/transfer
 * Mobile endpoint — send stock of a product from [shopId] to another shop.
 * The receiving shop has to approve it before the stock lands there (see
 * transfer-approval.server.ts); until then it's held at [shopId].
 *
 * Request body:
 *   productId  – Product.id (or ShopStock.id) to transfer from [shopId]
 *   toShopId   – destination Shop.id
 *   quantity   – number of units to transfer (> 0 and <= source quantity)
 *   variants?  – REQUIRED when the product is tracked by size/colour at the
 *                source shop: [{ size, color, quantity }, ...]. The total
 *                becomes the transfer quantity (any `quantity` sent is ignored).
 *   id?        – client-generated UUID, makes the call safe to retry
 *   notes?     – optional reason / notes
 *
 * App builds before approval existed call this as an instant transfer; the
 * same request now sends it for approval, and the message says so.
 *
 * Auth: verifyMobileShopAccess (portal_user must own the source shop; admins are bypassed)
 */

import { NextRequest } from 'next/server';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { denyWithoutCapability } from '@/lib/permissions.server';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { prepareSend, sendTransfer } from '@/lib/transfer-approval.server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    const denied = await denyWithoutCapability(auth.payload, 'transfer_stock', 'transfer stock');
    if (denied) return denied;

    const body = await request.json() as {
      id?: unknown;
      productId?: string;
      toShopId?: string;
      quantity?: number;
      variants?: unknown;
      notes?: string;
    };
    if (body.quantity == null && body.variants == null) {
      return jsonResponse({ success: false, error: 'productId, toShopId, and quantity are required', code: 'VALIDATION_ERROR' }, 400);
    }

    const prep = await prepareSend({ fromShopId: shopId, productId: body.productId, toShopId: body.toShopId });
    if (!prep.ok) {
      if ('response' in prep) return prep.response;
      if (prep.code === 'NOT_FOUND') logger.warn('Mobile stock transfer: not found', { shopId, productId: body.productId, error: prep.error });
      return jsonResponse({ success: false, error: prep.error, code: prep.code }, prep.status);
    }

    const sent = await sendTransfer({
      id: isValidClientId(body.id) ? (body.id as string) : null,
      organizationId: prep.organizationId,
      srcStock: prep.srcStock,
      fromShopId: shopId,
      toShop: prep.toShop,
      quantity: body.quantity,
      variants: body.variants,
      notes: body.notes ?? null,
      portalUserId: auth.portalUserId,
    });
    if (!sent.ok) return jsonResponse({ success: false, error: sent.error, code: sent.code }, sent.status);

    const t = sent.transfer;
    return jsonResponse({
      success: true,
      message: `${t.quantity} unit(s) sent to ${prep.toShop.name} — they'll be added there once ${prep.toShop.name} approves.`,
      data: {
        transferId: t.id,
        status: t.status,
        fromShopId: shopId,
        toShopId: prep.toShop.id,
        toShopName: prep.toShop.name,
        productId: prep.srcStock.productId,
        quantity: t.quantity,
      },
      ...(sent.created ? {} : { idempotent: true }),
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
