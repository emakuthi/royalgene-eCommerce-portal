/**
 * POST /api/mobile/shops/[shopId]/stock/transfer
 * Mobile endpoint — transfer stock of a product from [shopId] to another shop.
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
 * Every successful transfer also writes a StockTransfer row (status
 * 'confirmed', kind 'instant') so it shows up in the transfer history.
 *
 * Auth: verifyMobileShopAccess (portal_user must own the source shop; admins are bypassed)
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { hasVariantStock } from '@/lib/variant-stock.server';
import { moveVariantCells, normalizeTransferCells, type TransferCell } from '@/lib/stock-transfer.server';
import { v4 as uuidv4 } from 'uuid';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { idempotentInsert } from '@/lib/sync/idempotent-insert.server';

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
      variants?: unknown;
      notes?: string;
    };

    const { productId, toShopId, quantity, notes } = body;

    if (!productId || !toShopId || (quantity == null && body.variants == null)) {
      return jsonResponse(
        { success: false, error: 'productId, toShopId, and quantity are required', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    // Overwritten below with the cells' total when the product is tracked by size/colour.
    let transferQty = Number(quantity);
    if (body.variants == null && (!Number.isFinite(transferQty) || transferQty <= 0)) {
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

    // A product tracked by size/colour moves cell by cell — the client says
    // how many of each size/colour, and the total becomes the transfer quantity.
    let variantCells: TransferCell[] | null = null;
    if (await hasVariantStock(srcStock.id as string)) {
      const parsed = normalizeTransferCells(body.variants);
      if (!parsed.ok) {
        return jsonResponse({ success: false, error: parsed.error, code: 'VARIANTS_REQUIRED' }, 400);
      }
      variantCells = parsed.cells;
      transferQty = parsed.total;
    } else if (!Number.isFinite(transferQty) || transferQty <= 0) {
      return jsonResponse(
        { success: false, error: 'quantity must be a positive number', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    if (!variantCells && (srcStock.quantity as number) < transferQty) {
      return jsonResponse(
        { success: false, error: `Insufficient stock. Available: ${srcStock.quantity}, requested: ${transferQty}`, code: 'INSUFFICIENT_STOCK' },
        400,
      );
    }

    // Resolve source shop's organization — needed both to scope the required
    // inserts and to verify the destination shop below.
    const { data: srcShop } = await supabaseAdmin
      .from('Shop')
      .select('organizationId')
      .eq('id', shopId)
      .maybeSingle();
    if (!srcShop) {
      return jsonResponse({ success: false, error: 'Source shop not found', code: 'NOT_FOUND' }, 404);
    }
    const organizationId = srcShop.organizationId as string;

    const featureResponse = await assertFeatureEnabled(organizationId, FeatureCode.STOCK_TRANSFER);
    if (featureResponse) return featureResponse;

    // Verify destination shop exists AND belongs to the SAME organization as
    // the source — without this, stock could be transferred straight into a
    // completely different tenant's shop.
    const { data: destShop } = await supabaseAdmin
      .from('Shop')
      .select('id, name, organizationId')
      .eq('id', toShopId)
      .maybeSingle();

    if (!destShop) {
      return jsonResponse({ success: false, error: 'Destination shop not found', code: 'NOT_FOUND' }, 404);
    }
    if (destShop.organizationId !== organizationId) {
      logger.warn('Mobile stock transfer forbidden: destination shop in a different organization', {
        userId: auth.payload.userId, sourceOrg: organizationId, destOrg: destShop.organizationId, toShopId,
      });
      return jsonResponse({ success: false, error: 'Destination shop must belong to the same organization', code: 'FORBIDDEN' }, 403);
    }

    const resolvedProductId = srcStock.productId as string;
    const now = new Date().toISOString();
    const portalUserId = auth.portalUserId;

    const clientTransferId = isValidClientId((body as { id?: unknown }).id) ? (body as { id: string }).id : null;

    // ── Size/colour product: gate on the StockTransfer row, move cell by cell ──
    if (variantCells) {
      const transferId = clientTransferId ?? uuidv4();
      const reserved = await idempotentInsert('StockTransfer', {
        id: transferId,
        organizationId,
        productId: resolvedProductId,
        fromShopId: shopId,
        toShopId,
        quantity: transferQty,
        status: 'confirmed',
        kind: 'instant',
        variants: variantCells,
        notes: notes?.trim() ? notes.trim() : null,
        initiatedByPortalUserId: portalUserId,
        initiatedAt: now,
        resolvedByPortalUserId: portalUserId,
        resolvedAt: now,
      });
      if (!reserved.ok) {
        logger.error('Mobile variant stock transfer: failed to reserve transfer', { error: reserved.error });
        return jsonResponse({ success: false, error: 'Failed to record transfer', code: 'INTERNAL_ERROR' }, 500);
      }
      if (!reserved.created) {
        return jsonResponse({
          success: true,
          message: `${transferQty} unit(s) transferred to ${destShop.name}`,
          data: { fromShopId: shopId, toShopId, toShopName: destShop.name, productId: resolvedProductId, quantity: transferQty },
          idempotent: true,
        }, 200);
      }

      const { data: existingDest } = await supabaseAdmin
        .from('ShopStock')
        .select('id')
        .eq('shopId', toShopId)
        .eq('productId', resolvedProductId)
        .maybeSingle();
      let destStockId = existingDest?.id as string | undefined;
      let createdDestStock = false;
      if (!destStockId) {
        destStockId = uuidv4();
        // Starts at 0 — the variant rollup trigger sets the real total as the cells land.
        const { error: destInsertErr } = await supabaseAdmin.from('ShopStock').insert([{
          id: destStockId,
          organizationId,
          shopId: toShopId,
          productId: resolvedProductId,
          quantity: 0,
          lowStockThreshold: srcStock.lowStockThreshold ?? 5,
          createdAt: now,
          updatedAt: now,
        }]);
        if (destInsertErr) {
          await supabaseAdmin.from('StockTransfer').delete().eq('id', transferId);
          logger.error('Mobile variant stock transfer: failed to create destination stock', { error: destInsertErr.message });
          return jsonResponse({ success: false, error: 'Failed to update destination stock', code: 'INTERNAL_ERROR' }, 500);
        }
        createdDestStock = true;
      }

      const moved = await moveVariantCells({
        srcShopStockId: srcStock.id as string,
        destShopStockId: destStockId,
        organizationId,
        cells: variantCells,
      });
      if (!moved.ok) {
        // Nothing moved — drop the history row (and the empty destination row we just made) so a retry starts clean.
        await supabaseAdmin.from('StockTransfer').delete().eq('id', transferId);
        if (createdDestStock) await supabaseAdmin.from('ShopStock').delete().eq('id', destStockId);
        return jsonResponse({ success: false, error: moved.error, code: 'INSUFFICIENT_STOCK' }, 400);
      }

      const noteSuffix = notes?.trim() ? ` — ${notes.trim()}` : '';
      await supabaseAdmin.from('StockTransaction').insert(variantCells.flatMap((cell, i) => [
        {
          id: `${transferId}-out-${i}`,
          organizationId,
          shopStockId: srcStock.id,
          portalUserId,
          type: 'subtract',
          quantity: -cell.quantity,
          size: cell.size,
          color: cell.color,
          reason: `Mobile transfer out to ${destShop.name}${noteSuffix}`,
          reference: `mobile-transfer-${transferId}`,
          createdAt: now,
        },
        {
          id: `${transferId}-in-${i}`,
          organizationId,
          shopStockId: destStockId,
          portalUserId,
          type: 'add',
          quantity: cell.quantity,
          size: cell.size,
          color: cell.color,
          reason: `Mobile transfer in from shop ${shopId}${noteSuffix}`,
          reference: `mobile-transfer-${transferId}`,
          createdAt: now,
        },
      ]));

      try {
        await syncProductStockFromShopStocks(resolvedProductId);
      } catch (syncErr) {
        logger.warn('Mobile variant stock transfer: failed to sync product stockQuantity', {
          error: syncErr instanceof Error ? syncErr.message : String(syncErr),
          productId: resolvedProductId,
        });
      }

      logger.info('Mobile variant stock transfer completed', {
        userId: auth.payload.userId, fromShopId: shopId, toShopId, productId: resolvedProductId, quantity: transferQty, cells: variantCells.length,
      });

      return jsonResponse({
        success: true,
        message: `${transferQty} unit(s) transferred to ${destShop.name}`,
        data: { fromShopId: shopId, toShopId, toShopName: destShop.name, productId: resolvedProductId, quantity: transferQty, transferId },
      }, 200);
    }

    // Offline-first idempotency: this whole transfer (decrement + increment +
    // both audit rows) only happens once per client-supplied transfer id. The
    // "out" StockTransaction row is the gate — reserve it first; if it
    // already exists, every quantity change already happened on the first
    // attempt, so a retry just returns the current state and touches nothing.
    const outTxnId = clientTransferId ? `${clientTransferId}-out` : uuidv4();
    const inTxnId = clientTransferId ? `${clientTransferId}-in` : uuidv4();

    if (clientTransferId) {
      const reserved = await idempotentInsert('StockTransaction', {
        id: outTxnId,
        organizationId,
        shopStockId: srcStock.id,
        portalUserId,
        type: 'subtract',
        quantity: -transferQty,
        reason: `Mobile transfer out to ${destShop.name}${notes ? ` — ${notes}` : ''}`,
        reference: `mobile-transfer-${clientTransferId}`,
        createdAt: now,
        updatedAt: now,
      });
      if (!reserved.ok) {
        logger.error('Mobile stock transfer: failed to reserve transfer', { error: reserved.error });
        return jsonResponse({ success: false, error: 'Failed to record transfer', code: 'INTERNAL_ERROR' }, 500);
      }
      if (!reserved.created) {
        return jsonResponse({
          success: true,
          message: `${transferQty} unit(s) transferred to ${destShop.name}`,
          data: { fromShopId: shopId, toShopId, toShopName: destShop.name, productId: resolvedProductId, quantity: transferQty },
          idempotent: true,
        }, 200);
      }
    }

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
        organizationId,
        shopId: toShopId,
        productId: resolvedProductId,
        quantity: transferQty,
        lowStockThreshold: srcStock.lowStockThreshold ?? 5,
        createdAt: now,
        updatedAt: now,
      }]);
    }

    // StockTransaction records. The "out" leg is already reserved above when
    // the client supplied a transfer id; otherwise insert both fresh, as before.
    const rowsToInsert = [
      {
        id: inTxnId,
        organizationId,
        shopStockId: destStockId,
        portalUserId,
        type: 'add',
        quantity: transferQty,
        reason: `Mobile transfer in from shop ${shopId}${notes ? ` — ${notes}` : ''}`,
        reference: `mobile-transfer-${clientTransferId ?? now}`,
        createdAt: now,
      },
      ...(clientTransferId ? [] : [{
        id: outTxnId,
        organizationId,
        shopStockId: srcStock.id,
        portalUserId,
        type: 'subtract',
        quantity: -transferQty,
        reason: `Mobile transfer out to ${destShop.name}${notes ? ` — ${notes}` : ''}`,
        reference: `mobile-transfer-${now}`,
        createdAt: now,
      }]),
    ];
    await supabaseAdmin.from('StockTransaction').insert(rowsToInsert);

    // History row for the transfer list. Best-effort: the stock has already
    // moved and is audited above, so a failure here must not fail the transfer.
    // Keyed on the client's transfer id when it sent one, so a retry can't add a second row.
    const historyId = clientTransferId ?? uuidv4();
    const history = await idempotentInsert('StockTransfer', {
      id: historyId,
      organizationId,
      productId: resolvedProductId,
      fromShopId: shopId,
      toShopId,
      quantity: transferQty,
      status: 'confirmed',
      kind: 'instant',
      notes: notes?.trim() ? notes.trim() : null,
      initiatedByPortalUserId: portalUserId,
      initiatedAt: now,
      resolvedByPortalUserId: portalUserId,
      resolvedAt: now,
    });
    if (!history.ok) {
      logger.warn('Mobile stock transfer: failed to write history row', { error: history.error, historyId });
    }

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

