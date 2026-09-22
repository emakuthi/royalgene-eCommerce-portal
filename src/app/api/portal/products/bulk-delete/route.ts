/**
 * POST /api/portal/products/bulk-delete
 * Body: { productIds: string[] }   (1–50 ids)
 *
 * Delete several products in one call — the web portal's counterpart to
 * POST /api/mobile/products/bulk-delete (same shared helper, same rules):
 * workspace admins only, removes each product from EVERY shop (not just the
 * one currently in view), and a product that already has sales history is
 * archived instead of erased so its sales stay intact (reported back in
 * `archived`, distinct from `deleted`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { hasCapability } from '@/lib/permissions.server';
import { deleteProductsInOrg } from '@/lib/product-delete.server';

const MAX_IDS = 50;

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const isAdmin = payload.role === 'admin' || payload.role === 'super_admin';
    if (!isAdmin || !(await hasCapability(payload, 'delete_inventory'))) {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete inventory.' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { productIds?: unknown };
    const productIds = Array.isArray(body.productIds) ? body.productIds.filter((x): x is string => typeof x === 'string') : [];
    if (productIds.length === 0) {
      return jsonResponse({ success: false, error: 'productIds is required' }, 400);
    }
    if (productIds.length > MAX_IDS) {
      return jsonResponse({ success: false, error: `Delete at most ${MAX_IDS} products at a time` }, 400);
    }

    // organizationId is guaranteed by requireTenantUser above.
    const outcome = await deleteProductsInOrg(payload.organizationId as string, productIds);

    void trackFromRequest(request, payload, {
      action: 'product.bulk_delete', category: 'product',
      details: { requested: productIds.length, deleted: outcome.deleted.length, archived: outcome.archived.length, failed: outcome.failed.length },
    });

    logger.info('Portal bulk product delete', {
      userId: payload.userId, organizationId: payload.organizationId, requested: productIds.length,
      deleted: outcome.deleted.length, archived: outcome.archived.length, failed: outcome.failed.length,
    });

    const removed = outcome.deleted.length + outcome.archived.length;
    return jsonResponse({
      success: removed > 0 || outcome.failed.length === 0,
      data: outcome,
      message: outcome.archived.length > 0
        ? `${removed} removed — ${outcome.archived.length} had sales history, so ${outcome.archived.length === 1 ? 'it was' : 'they were'} archived instead of erased.`
        : `${removed} removed`,
    }, removed > 0 || outcome.failed.length === 0 ? 200 : 500);
  } catch (error) {
    logger.error('Portal bulk product delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
