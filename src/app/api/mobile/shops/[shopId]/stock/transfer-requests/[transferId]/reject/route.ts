/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests/[transferId]/reject
 * The RECEIVING shop declines a pending transfer: [shopId] must be its
 * toShopId. The held stock goes back to the sending shop; nothing was ever
 * added here.
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
    const body = await request.json().catch(() => ({})) as { reason?: string };

    const res = await returnTransfer({ transferId, action: 'reject', shopId, portalUserId: auth.portalUserId, reason: body.reason ?? null });
    if (!res.ok) return jsonResponse({ success: false, error: res.error, code: res.code }, res.status);
    if (res.idempotent) return jsonResponse({ success: true, data: res.transfer, idempotent: true }, 200);
    return jsonResponse({ success: true, data: res.transfer, message: 'Transfer rejected' }, 200);
  } catch (error) {
    logger.error('Stock transfer reject error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
