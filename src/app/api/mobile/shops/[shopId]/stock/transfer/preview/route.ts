/**
 * GET /api/mobile/shops/[shopId]/stock/transfer/preview?productId=…&toShopId=…
 * Read-only: what a transfer of `productId` from [shopId] into `toShopId`
 * would do, and what's already on the receiving side. The transfer dialog
 * shows it when a destination is picked, so the user can see that e.g. the
 * stock will be added to the receiving shop's own "Mira short" with the same
 * SKU — and spot a name typo — before sending.
 *
 * productId may be the Product id or the source ShopStock id.
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { buildTransferPreview } from '@/lib/product-sku.server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const toShopId = searchParams.get('toShopId');
    if (!productId || !toShopId) {
      return jsonResponse({ success: false, error: 'productId and toShopId are required', code: 'VALIDATION_ERROR' }, 400);
    }

    let { data: srcStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, productId')
      .eq('shopId', shopId)
      .eq('productId', productId)
      .maybeSingle();
    if (!srcStock) {
      srcStock = (await supabaseAdmin
        .from('ShopStock')
        .select('id, productId')
        .eq('shopId', shopId)
        .eq('id', productId)
        .maybeSingle()).data;
    }
    if (!srcStock) {
      return jsonResponse({ success: false, error: 'Product not found in source shop', code: 'NOT_FOUND' }, 404);
    }

    const { data: shops } = await supabaseAdmin.from('Shop').select('id, name, organizationId').in('id', [shopId, toShopId]);
    const src = shops?.find((s) => s.id === shopId);
    const dest = shops?.find((s) => s.id === toShopId);
    if (!src || !dest || dest.organizationId !== src.organizationId) {
      return jsonResponse({ success: false, error: 'Destination shop not found', code: 'NOT_FOUND' }, 404);
    }

    const preview = await buildTransferPreview({
      organizationId: src.organizationId as string,
      productId: srcStock.productId as string,
      toShopId,
      toShopName: dest.name as string,
      srcShopStockId: srcStock.id as string,
    });
    return jsonResponse({ success: true, data: preview }, 200);
  } catch (error) {
    logger.error('Stock transfer preview error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
