/**
 * POST /api/mobile/products/bulk-delete
 * Body: { productIds: string[] }   (1–50 ids)
 * Delete several products in one call. Workspace admins only — this removes
 * the product from EVERY shop, not just the one being viewed. Products that
 * have sales history are archived instead of erased (reported in `archived`).
 *
 * The single-product form is DELETE /api/mobile/shops/[shopId]/products/[productId].
 */
import { NextRequest } from 'next/server';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { hasCapability } from '@/lib/permissions.server';
import { deleteProductsInOrg, logProductDeletes, PRODUCT_DELETED_MESSAGE } from '@/lib/product-delete.server';

const MAX_IDS = 50;

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;

    const organizationId = auth.payload.organizationId ?? null;
    if (!organizationId) {
      return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
    }
    if (!auth.isAdmin || !(await hasCapability(auth.payload, 'delete_inventory'))) {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete inventory.', code: 'FORBIDDEN' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { productIds?: unknown };
    const productIds = Array.isArray(body.productIds) ? body.productIds.filter((x): x is string => typeof x === 'string') : [];
    if (productIds.length === 0) {
      return jsonResponse({ success: false, error: 'productIds is required', code: 'VALIDATION_ERROR' }, 400);
    }
    if (productIds.length > MAX_IDS) {
      return jsonResponse({ success: false, error: `Delete at most ${MAX_IDS} products at a time`, code: 'VALIDATION_ERROR' }, 400);
    }

    const outcome = await deleteProductsInOrg(organizationId, productIds);
    await logProductDeletes(request, auth.payload, outcome);
    logger.info('Mobile bulk product delete', {
      userId: auth.payload.userId, organizationId, requested: productIds.length,
      deleted: outcome.deleted.length, archived: outcome.archived.length, failed: outcome.failed.length,
    });

    const removed = outcome.deleted.length + outcome.archived.length;
    return jsonResponse({
      success: removed > 0 || outcome.failed.length === 0,
      data: outcome,
      message: removed === 1 ? PRODUCT_DELETED_MESSAGE : `${removed} products deleted. A workspace admin can bring them back with their stock and history from Deleted Products on the web portal.`,
    }, removed > 0 || outcome.failed.length === 0 ? 200 : 500);
  } catch (error) {
    logger.error('Mobile bulk product delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
