/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/reject
 * The DESTINATION shop declines a pending transfer: [shopId] must be the
 * transfer's toShopId. Gives the reserved quantity back to the source shop
 * — nothing was ever added to the destination, so there's nothing to undo
 * there.
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { returnReservedStock } from '@/lib/stock-transfer.server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; transferId: string }> },
) {
  try {
    const { shopId, transferId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const body = await request.json().catch(() => ({})) as { reason?: string };

    const { data: transfer } = await supabaseAdmin.from('StockTransfer').select('*').eq('id', transferId).maybeSingle();
    if (!transfer) return jsonResponse({ success: false, error: 'Transfer request not found', code: 'NOT_FOUND' }, 404);
    if (transfer.toShopId !== shopId) {
      return jsonResponse({ success: false, error: 'Only the destination shop can reject this transfer', code: 'FORBIDDEN' }, 403);
    }
    if (transfer.status === 'rejected') {
      return jsonResponse({ success: true, data: transfer, idempotent: true }, 200);
    }
    if (transfer.status !== 'pending') {
      return jsonResponse({ success: false, error: `This transfer was already ${transfer.status}`, code: 'ALREADY_RESOLVED' }, 409);
    }

    const now = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('StockTransfer')
      .update({ status: 'rejected', resolvedByPortalUserId: auth.portalUserId, resolvedAt: now, rejectionReason: body.reason ?? null })
      .eq('id', transferId)
      .eq('status', 'pending')
      .select('*');

    if (claimError) {
      logger.error('Stock transfer reject: claim failed', { error: claimError.message, transferId });
      return jsonResponse({ success: false, error: 'Failed to reject transfer', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!claimedRows || claimedRows.length === 0) {
      return jsonResponse({ success: false, error: 'This transfer was already resolved', code: 'ALREADY_RESOLVED' }, 409);
    }

    await returnReservedStock(transfer.productId as string, transfer.fromShopId as string, transfer.quantity as number);

    logger.info('Stock transfer rejected', { userId: auth.payload.userId, transferId, toShopId: shopId });

    return jsonResponse({ success: true, data: claimedRows[0], message: 'Transfer rejected' }, 200);
  } catch (error) {
    logger.error('Stock transfer reject error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
