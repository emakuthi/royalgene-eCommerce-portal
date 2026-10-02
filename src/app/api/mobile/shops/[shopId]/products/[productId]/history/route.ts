import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { buildProductHistory } from '@/lib/product-history.server';
import logger from '@/lib/logger';

/**
 * GET /api/mobile/shops/[shopId]/products/[productId]/history
 * Full activity timeline for a product (created, sales, restocks, adjustments,
 * transfers, field edits) — org-scoped, assembled from the StockTransaction
 * ledger + activity_logs. [productId] may be the Product UUID or a ShopStock
 * UUID (same tolerance as the product detail route).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; productId: string }> },
) {
  try {
    const { shopId, productId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const organizationId = auth.payload.organizationId;
    if (!organizationId) {
      return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
    }

    // Resolve the caller's id (Product id OR ShopStock id) to a real Product id.
    let resolvedProductId: string | null = null;
    const { data: asProduct } = await supabaseAdmin
      .from('Product')
      .select('id')
      .eq('id', productId)
      .eq('organizationId', organizationId)
      .maybeSingle();
    if (asProduct) {
      resolvedProductId = asProduct.id as string;
    } else {
      const { data: asStock } = await supabaseAdmin
        .from('ShopStock')
        .select('productId')
        .eq('id', productId)
        .eq('organizationId', organizationId)
        .maybeSingle();
      resolvedProductId = (asStock?.productId as string) ?? null;
    }

    if (!resolvedProductId) {
      return jsonResponse({ success: false, error: 'Product not found', code: 'NOT_FOUND' }, 404);
    }

    const events = await buildProductHistory(organizationId, resolvedProductId);
    if (events === null) {
      return jsonResponse({ success: false, error: 'Product not found', code: 'NOT_FOUND' }, 404);
    }

    return jsonResponse({ success: true, data: { events } });
  } catch (error) {
    logger.error('Mobile product history error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
