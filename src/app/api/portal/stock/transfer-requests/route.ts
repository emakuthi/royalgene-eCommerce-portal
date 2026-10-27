/**
 * GET /api/portal/stock/transfer-requests?status=pending
 * Transfers the caller can see: admins every shop in the business, other
 * users their own shop's. Each row says `direction` from the caller's side
 * ('incoming' = waiting for this shop to approve) and `canApprove` /
 * `canCancel`. `pendingIncoming` is the count for the menu badge.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { assignedShopId } from '@/lib/portal-transfer-access.server';

export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;

    const status = new URL(request.url).searchParams.get('status');
    const myShop = await assignedShopId(auth);

    let query = supabaseAdmin
      .from('StockTransfer')
      .select('id, productId, fromShopId, toShopId, quantity, status, kind, variants, notes, rejectionReason, initiatedAt, resolvedAt, Product(id, name, sku, images), fromShop:Shop!StockTransfer_fromShopId_fkey(id, name), toShop:Shop!StockTransfer_toShopId_fkey(id, name)')
      .eq('organizationId', auth.organizationId as string)
      .eq('kind', 'request')
      .order('initiatedAt', { ascending: false })
      .limit(200);
    if (status) query = query.eq('status', status);
    if (myShop !== null) query = query.or(`fromShopId.eq.${myShop},toShopId.eq.${myShop}`);

    const { data, error } = await query;
    if (error) {
      logger.error('Portal transfer requests GET failed', { error: error.message });
      return jsonResponse({ success: false, error: 'Failed to load transfers' }, 500);
    }

    const transfers = (data ?? []).map((row: Record<string, unknown>) => {
      const pending = row.status === 'pending';
      const incoming = myShop === null || row.toShopId === myShop;
      const outgoing = myShop === null || row.fromShopId === myShop;
      return {
        ...row,
        direction: myShop === null ? 'all' : row.toShopId === myShop ? 'incoming' : 'outgoing',
        canApprove: pending && incoming,
        canCancel: pending && outgoing,
      };
    });
    const pendingIncoming = transfers.filter((t) => t.canApprove).length;

    return jsonResponse({ success: true, data: { transfers, pendingIncoming } }, 200);
  } catch (error) {
    logger.error('Portal transfer requests GET error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
