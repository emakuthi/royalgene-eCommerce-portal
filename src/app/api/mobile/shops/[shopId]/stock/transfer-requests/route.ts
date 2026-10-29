/**
 * POST /api/mobile/shops/[shopId]/stock/transfer-requests
 * Send stock FROM [shopId] for the receiving shop to approve — the same as
 * POST .../stock/transfer, which is now approval-based too. The quantity is
 * held at [shopId] at once (status 'pending'); the receiving shop gets it
 * only when it approves (.../transfer-requests/[transferId]/confirm). See
 * transfer-approval.server.ts. Size/colour products send `variants`.
 *
 * GET /api/mobile/shops/[shopId]/stock/transfer-requests?status=pending
 * Lists transfers where [shopId] is either the source or the destination,
 * each row tagged with `direction: 'outgoing' | 'incoming'` so one call
 * covers both "what did I send" and "what's waiting for me to confirm".
 * Pending incoming rows also carry `destinationPreview` (see buildTransferPreview).
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { denyWithoutCapability } from '@/lib/permissions.server';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { buildTransferPreview } from '@/lib/product-sku.server';
import { prepareSend, sendTransfer } from '@/lib/transfer-approval.server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;
    const denied = await denyWithoutCapability(auth.payload, 'transfer_stock', 'transfer stock');
    if (denied) return denied;

    const body = await request.json() as {
      id?: string;
      productId?: string;
      toShopId?: string;
      quantity?: number;
      variants?: unknown;
      notes?: string;
    };
    if (body.quantity == null && body.variants == null) {
      return jsonResponse({ success: false, error: 'productId, toShopId, and quantity are required', code: 'VALIDATION_ERROR' }, 400);
    }

    const prep = await prepareSend({ fromShopId: shopId, productId: body.productId, toShopId: body.toShopId });
    if (!prep.ok) {
      if ('response' in prep) return prep.response;
      return jsonResponse({ success: false, error: prep.error, code: prep.code }, prep.status);
    }

    // Same as POST .../stock/transfer: held here, lands once the receiving shop approves.
    const sent = await sendTransfer({
      id: isValidClientId(body.id) ? (body.id as string) : null,
      organizationId: prep.organizationId,
      srcStock: prep.srcStock,
      fromShopId: shopId,
      toShop: prep.toShop,
      quantity: body.quantity,
      variants: body.variants,
      notes: body.notes ?? null,
      portalUserId: auth.portalUserId,
    });
    if (!sent.ok) return jsonResponse({ success: false, error: sent.error, code: sent.code }, sent.status);
    if (!sent.created) return jsonResponse({ success: true, data: sent.transfer, idempotent: true }, 200);

    return jsonResponse({
      success: true,
      data: { ...sent.transfer, toShopName: prep.toShop.name },
      message: `Transfer request sent to ${prep.toShop.name}`,
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

    // Incoming requests still waiting on this shop carry a preview of where
    // the stock will land here (e.g. added to this shop's own same-SKU
    // product), so whoever confirms can see both names and spot a typo.
    const transfers = await Promise.all((data ?? []).map(async (row: Record<string, unknown>) => {
      const direction = row.fromShopId === shopId ? 'outgoing' : 'incoming';
      if (direction !== 'incoming' || row.status !== 'pending') return { ...row, direction };
      const { data: srcStock } = await supabaseAdmin
        .from('ShopStock')
        .select('id')
        .eq('shopId', row.fromShopId as string)
        .eq('productId', row.productId as string)
        .maybeSingle();
      const destinationPreview = await buildTransferPreview({
        organizationId: row.organizationId as string,
        productId: row.productId as string,
        toShopId: shopId,
        toShopName: ((row.toShop as { name?: string } | null)?.name) ?? 'This shop',
        srcShopStockId: (srcStock?.id as string | undefined) ?? null,
      }).catch(() => null);
      return { ...row, direction, destinationPreview };
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
