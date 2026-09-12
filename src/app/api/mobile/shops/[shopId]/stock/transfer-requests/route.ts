/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests
 * Initiate a two-party stock transfer FROM [shopId]. Distinct from the
 * existing instant transfer (POST .../stock/transfer, unchanged, still
 * atomic/one-call): this reserves the quantity from the source shop
 * immediately (status 'pending') but does NOT touch the destination shop —
 * that only happens when the destination confirms
 * (.../transfer-requests/[transferId]/confirm).
 *
 * GET /api/mobile/shops/[shopId]/stock/transfer-requests?status=pending
 * Lists transfers where [shopId] is either the source or the destination,
 * each row tagged with `direction: 'outgoing' | 'incoming'` so one call
 * covers both "what did I send" and "what's waiting for me to confirm".
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { hasVariantStock } from '@/lib/variant-stock.server';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { idempotentInsert } from '@/lib/sync/idempotent-insert.server';
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
      id?: string;
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
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return jsonResponse({ success: false, error: 'quantity must be a positive number', code: 'VALIDATION_ERROR' }, 400);
    }
    if (shopId === toShopId) {
      return jsonResponse({ success: false, error: 'Source and destination shops must be different', code: 'VALIDATION_ERROR' }, 400);
    }

    let { data: srcStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, productId, quantity, lowStockThreshold')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .maybeSingle();
    if (!srcStock) {
      const fallback = await supabaseAdmin
        .from('ShopStock')
        .select('id, productId, quantity, lowStockThreshold')
        .eq('shopId', shopId)
        .eq('id', productId)
        .maybeSingle();
      if (fallback.data) srcStock = fallback.data;
    }
    if (!srcStock) {
      return jsonResponse({ success: false, error: 'Product not found in source shop', code: 'NOT_FOUND' }, 404);
    }

    if (await hasVariantStock(srcStock.id as string)) {
      return jsonResponse({
        success: false,
        error: 'This product is tracked by size/colour — adjust the breakdown at each shop instead.',
        code: 'VARIANT_STOCK',
      }, 409);
    }

    if ((srcStock.quantity as number) < qty) {
      return jsonResponse(
        { success: false, error: `Insufficient stock. Available: ${srcStock.quantity}, requested: ${qty}`, code: 'INSUFFICIENT_STOCK' },
        400,
      );
    }

    const { data: srcShop } = await supabaseAdmin.from('Shop').select('organizationId').eq('id', shopId).maybeSingle();
    if (!srcShop) return jsonResponse({ success: false, error: 'Source shop not found', code: 'NOT_FOUND' }, 404);
    const organizationId = srcShop.organizationId as string;

    const featureResponse = await assertFeatureEnabled(organizationId, FeatureCode.STOCK_TRANSFER);
    if (featureResponse) return featureResponse;

    const { data: destShop } = await supabaseAdmin.from('Shop').select('id, name, organizationId').eq('id', toShopId).maybeSingle();
    if (!destShop) return jsonResponse({ success: false, error: 'Destination shop not found', code: 'NOT_FOUND' }, 404);
    if (destShop.organizationId !== organizationId) {
      return jsonResponse({ success: false, error: 'Destination shop must belong to the same organization', code: 'FORBIDDEN' }, 403);
    }

    const resolvedProductId = srcStock.productId as string;
    const transferId = isValidClientId(body.id) ? (body.id as string) : uuidv4();
    const now = new Date().toISOString();

    // Idempotent: reserving the StockTransfer row IS the gate. If it already
    // exists (a retry), the source decrement already happened on the first
    // attempt — return the existing row, touch nothing else.
    const reserved = await idempotentInsert('StockTransfer', {
      id: transferId,
      organizationId,
      productId: resolvedProductId,
      fromShopId: shopId,
      toShopId,
      quantity: qty,
      status: 'pending',
      notes: notes ?? null,
      initiatedByPortalUserId: auth.portalUserId,
      initiatedAt: now,
    });
    if (!reserved.ok) {
      logger.error('Stock transfer request: failed to reserve', { error: reserved.error });
      return jsonResponse({ success: false, error: 'Failed to create transfer request', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!reserved.created) {
      return jsonResponse({ success: true, data: reserved.row, idempotent: true }, 200);
    }

    const newSrcQty = (srcStock.quantity as number) - qty;
    const { error: decErr } = await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: newSrcQty, updatedAt: now })
      .eq('id', srcStock.id);
    if (decErr) {
      logger.error('Stock transfer request: failed to reserve source quantity', { error: decErr.message, shopStockId: srcStock.id });
      return jsonResponse({ success: false, error: 'Failed to reserve stock', code: 'INTERNAL_ERROR' }, 500);
    }

    logger.info('Stock transfer request initiated', {
      userId: auth.payload.userId, transferId, fromShopId: shopId, toShopId, productId: resolvedProductId, quantity: qty,
    });

    return jsonResponse({
      success: true,
      data: { ...reserved.row, toShopName: destShop.name },
      message: `Transfer request sent to ${destShop.name}`,
    }, 201);
  } catch (error) {
    logger.error('Stock transfer request POST error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from('StockTransfer')
      .select('*, Product(id, name, sku, images), fromShop:Shop!StockTransfer_fromShopId_fkey(id, name), toShop:Shop!StockTransfer_toShopId_fkey(id, name)')
      .or(`fromShopId.eq.${shopId},toShopId.eq.${shopId}`)
      .order('initiatedAt', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      logger.error('Stock transfer request GET failed', { error: error.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to fetch transfer requests', code: 'INTERNAL_ERROR' }, 500);
    }

    const transfers = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      direction: row.fromShopId === shopId ? 'outgoing' : 'incoming',
    }));

    return jsonResponse({ success: true, data: { transfers } }, 200);
  } catch (error) {
    logger.error('Stock transfer request GET error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
