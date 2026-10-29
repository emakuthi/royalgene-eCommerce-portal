/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/confirm
 * The RECEIVING shop approves a pending transfer: [shopId] must be its
 * toShopId. Only now is the stock added here — to this product, or this
 * shop's own same-SKU product — and the "in" history row written.
 * See transfer-approval.server.ts.
 */
import { NextRequest } from 'next/server';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { denyWithoutCapability } from '@/lib/permissions.server';
import { approveTransfer } from '@/lib/transfer-approval.server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; transferId: string }> },
) {
  try {
    const { shopId, transferId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    const denied = await denyWithoutCapability(auth.payload, 'approve_transfers', 'approve transfers');
    if (denied) return denied;

    const res = await approveTransfer({ transferId, shopId, portalUserId: auth.portalUserId });
    if (!res.ok) return jsonResponse({ success: false, error: res.error, code: res.code }, res.status);
    if (res.idempotent) return jsonResponse({ success: true, data: res.transfer, idempotent: true }, 200);
    return jsonResponse({ success: true, data: res.transfer, message: 'Transfer approved' }, 200);
  } catch (error) {
    logger.error('Stock transfer confirm error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
