/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/cancel
 * The SOURCE shop takes back a still-pending transfer before the
 * destination has acted on it: [shopId] must be the transfer's
 * fromShopId. Same stock-return effect as reject, different actor/status —
 * kept as a separate endpoint so the two are never confused in the audit
 * trail (a destination that never even had the chance to decide vs. one
 * that actively declined).
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

    const { data: transfer } = await supabaseAdmin.from('StockTransfer').select('*').eq('id', transferId).maybeSingle();
    if (!transfer) return jsonResponse({ success: false, error: 'Transfer request not found', code: 'NOT_FOUND' }, 404);
    if (transfer.fromShopId !== shopId) {
      return jsonResponse({ success: false, error: 'Only the source shop can cancel this transfer', code: 'FORBIDDEN' }, 403);
    }
    if (transfer.status === 'cancelled') {
      return jsonResponse({ success: true, data: transfer, idempotent: true }, 200);
    }
    if (transfer.status !== 'pending') {
      return jsonResponse({ success: false, error: `This transfer was already ${transfer.status}`, code: 'ALREADY_RESOLVED' }, 409);
    }

    const now = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('StockTransfer')
      .update({ status: 'cancelled', resolvedByPortalUserId: auth.portalUserId, resolvedAt: now })
      .eq('id', transferId)
      .eq('status', 'pending')
      .select('*');

    if (claimError) {
      logger.error('Stock transfer cancel: claim failed', { error: claimError.message, transferId });
      return jsonResponse({ success: false, error: 'Failed to cancel transfer', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!claimedRows || claimedRows.length === 0) {
      return jsonResponse({ success: false, error: 'This transfer was already resolved', code: 'ALREADY_RESOLVED' }, 409);
    }

    await returnReservedStock(transfer.productId as string, transfer.fromShopId as string, transfer.quantity as number);

    logger.info('Stock transfer cancelled', { userId: auth.payload.userId, transferId, fromShopId: shopId });

    return jsonResponse({ success: true, data: claimedRows[0], message: 'Transfer cancelled' }, 200);
  } catch (error) {
    logger.error('Stock transfer cancel error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
