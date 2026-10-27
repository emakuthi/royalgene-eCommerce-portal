/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/cancel
 * The SENDING shop takes back a still-pending transfer: [shopId] must be
 * its fromShopId. Same stock return as reject, kept separate so the history
 * tells "never decided" apart from "declined".
 * See transfer-approval.server.ts.
 */
import { NextRequest } from 'next/server';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { returnTransfer } from '@/lib/transfer-approval.server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; transferId: string }> },
) {
  try {
    const { shopId, transferId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const res = await returnTransfer({ transferId, action: 'cancel', shopId, portalUserId: auth.portalUserId });
    if (!res.ok) return jsonResponse({ success: false, error: res.error, code: res.code }, res.status);
    if (res.idempotent) return jsonResponse({ success: true, data: res.transfer, idempotent: true }, 200);
    return jsonResponse({ success: true, data: res.transfer, message: 'Transfer cancelled' }, 200);
  } catch (error) {
    logger.error('Stock transfer cancel error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
