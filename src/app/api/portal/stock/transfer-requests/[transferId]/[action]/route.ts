/**
 * POST /api/portal/stock/transfer-requests/[transferId]/(confirm|reject|cancel)
 * confirm / reject: for the receiving shop. cancel: for the sending shop.
 * Admins act for any shop in their business; other users only for their
 * own. Body for reject: { reason? }. See transfer-approval.server.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { approveTransfer, returnTransfer } from '@/lib/transfer-approval.server';
import { canActForShop, portalUserIdFor } from '@/lib/portal-transfer-access.server';

const MESSAGES = { confirm: 'Transfer approved', reject: 'Transfer rejected', cancel: 'Transfer cancelled' } as const;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ transferId: string; action: string }> },
) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const { transferId, action } = await context.params;
    if (action !== 'confirm' && action !== 'reject' && action !== 'cancel') {
      return jsonResponse({ success: false, error: 'Unknown action' }, 404);
    }

    const { data: transfer } = await supabaseAdmin
      .from('StockTransfer')
      .select('id, organizationId, fromShopId, toShopId')
      .eq('id', transferId)
      .maybeSingle();
    if (!transfer || transfer.organizationId !== auth.organizationId) {
      return jsonResponse({ success: false, error: 'Transfer not found' }, 404);
    }
    const shopId = (action === 'cancel' ? transfer.fromShopId : transfer.toShopId) as string;
    if (!(await canActForShop(auth, shopId))) {
      const who = action === 'cancel' ? 'sending' : 'receiving';
      return jsonResponse({ success: false, error: `Only the ${who} shop can ${action === 'confirm' ? 'approve' : action} this transfer` }, 403);
    }

    const body = action === 'reject' ? await request.json().catch(() => ({})) as { reason?: string } : {};
    const portalUserId = await portalUserIdFor(auth, shopId);
    const res = action === 'confirm'
      ? await approveTransfer({ transferId, shopId, portalUserId })
      : await returnTransfer({ transferId, action, shopId, portalUserId, reason: body.reason ?? null });
    if (!res.ok) return jsonResponse({ success: false, error: res.error, code: res.code }, res.status);

    if (!res.idempotent) {
      void trackFromRequest(request, auth, {
        action: `stock.transfer.${action}`,
        category: 'stock',
        resourceType: 'StockTransfer',
        resourceId: transferId,
        shopId,
        details: { fromShopId: transfer.fromShopId, toShopId: transfer.toShopId, reason: body.reason },
      });
    }
    return jsonResponse({ success: true, data: res.transfer, message: MESSAGES[action], ...(res.idempotent ? { idempotent: true } : {}) }, 200);
  } catch (error) {
    logger.error('Portal transfer action error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
