/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/confirm
 * The DESTINATION shop confirms receipt: [shopId] must be the transfer's
 * toShopId. Increments (or creates) the destination ShopStock row and
 * writes both StockTransaction audit legs NOW — not at initiate time,
 * since nothing actually moved into this shop until this call.
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { v4 as uuidv4 } from 'uuid';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; transferId: string }> },
) {
  try {
    const { shopId, transferId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const { data: transfer } = await supabaseAdmin
      .from('StockTransfer')
      .select('*')
      .eq('id', transferId)
      .maybeSingle();

    if (!transfer) {
      return jsonResponse({ success: false, error: 'Transfer request not found', code: 'NOT_FOUND' }, 404);
    }
    if (transfer.toShopId !== shopId) {
      return jsonResponse({ success: false, error: 'Only the destination shop can confirm this transfer', code: 'FORBIDDEN' }, 403);
    }
    if (transfer.status !== 'pending') {
      // Already resolved (confirm is itself idempotent for a retry of the SAME resolution, but not a status flip).
      if (transfer.status === 'confirmed') {
        return jsonResponse({ success: true, data: transfer, idempotent: true }, 200);
      }
      return jsonResponse({ success: false, error: `This transfer was already ${transfer.status}`, code: 'ALREADY_RESOLVED' }, 409);
    }

    // Claim it first — a conditional UPDATE gated on still-pending status is
    // the atomic compare-and-swap: two concurrent confirm calls can't both
    // apply the stock increment.
    const now = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('StockTransfer')
      .update({ status: 'confirmed', resolvedByPortalUserId: auth.portalUserId, resolvedAt: now })
      .eq('id', transferId)
      .eq('status', 'pending')
      .select('*');

    if (claimError) {
      logger.error('Stock transfer confirm: claim failed', { error: claimError.message, transferId });
      return jsonResponse({ success: false, error: 'Failed to confirm transfer', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!claimedRows || claimedRows.length === 0) {
      return jsonResponse({ success: false, error: 'This transfer was already resolved', code: 'ALREADY_RESOLVED' }, 409);
    }
    const claimed = claimedRows[0];

    const { data: destStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, quantity, lowStockThreshold')
      .eq('shopId', shopId)
      .eq('productId', transfer.productId)
      .maybeSingle();

    let destStockId: string;
    if (destStock) {
      await supabaseAdmin.from('ShopStock').update({ quantity: (destStock.quantity as number) + transfer.quantity, updatedAt: now }).eq('id', destStock.id);
      destStockId = destStock.id as string;
    } else {
      destStockId = uuidv4();
      await supabaseAdmin.from('ShopStock').insert([{
        id: destStockId,
        organizationId: transfer.organizationId,
        shopId,
        productId: transfer.productId,
        quantity: transfer.quantity,
        lowStockThreshold: 5,
        createdAt: now,
        updatedAt: now,
      }]);
    }

    const { data: srcStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id')
      .eq('shopId', transfer.fromShopId)
      .eq('productId', transfer.productId)
      .maybeSingle();

    await supabaseAdmin.from('StockTransaction').insert([
      {
        id: uuidv4(),
        organizationId: transfer.organizationId,
        shopStockId: destStockId,
        portalUserId: auth.portalUserId,
        type: 'add',
        quantity: transfer.quantity,
        reason: `Transfer confirmed from shop ${transfer.fromShopId}${transfer.notes ? ` — ${transfer.notes}` : ''}`,
        reference: `transfer-request-${transferId}`,
        createdAt: now,
      },
      ...(srcStock ? [{
        id: uuidv4(),
        organizationId: transfer.organizationId,
        shopStockId: srcStock.id,
        portalUserId: transfer.initiatedByPortalUserId,
        type: 'subtract',
        quantity: -transfer.quantity,
        reason: `Transfer confirmed to shop ${shopId}${transfer.notes ? ` — ${transfer.notes}` : ''}`,
        reference: `transfer-request-${transferId}`,
        createdAt: now,
      }] : []),
    ]);

    try {
      await syncProductStockFromShopStocks(transfer.productId as string);
    } catch (syncErr) {
      logger.warn('Stock transfer confirm: failed to sync product stockQuantity', {
        error: syncErr instanceof Error ? syncErr.message : String(syncErr), productId: transfer.productId,
      });
    }

    logger.info('Stock transfer confirmed', { userId: auth.payload.userId, transferId, toShopId: shopId });

    return jsonResponse({ success: true, data: claimed, message: 'Transfer confirmed' }, 200);
  } catch (error) {
    logger.error('Stock transfer confirm error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
