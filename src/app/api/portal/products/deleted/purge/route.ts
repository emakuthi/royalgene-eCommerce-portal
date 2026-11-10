/**
 * POST /api/portal/products/deleted/purge
 * Body: { id: string }
 * "Delete permanently" — the product leaves Deleted Products for good and can't be
 * restored. Its sales, orders and transfers keep their history — see
 * purgeDeletedProduct. Admins only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { purgeDeletedProduct } from '@/lib/product-restore.server';

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can permanently delete a product.' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return jsonResponse({ success: false, error: 'id is required' }, 400);

    const result = await purgeDeletedProduct(payload.organizationId as string, id);
    if (!result.ok) return jsonResponse({ success: false, error: 'Product not found', code: result.code }, 404);

    await trackFromRequest(request, payload, {
      action: 'product.purge', category: 'product', resourceType: 'product', resourceId: id,
      details: { erased: result.erased },
    });
    logger.info('Product permanently deleted', { productId: id, userId: payload.userId, erased: result.erased });

    return jsonResponse({ success: true, data: { erased: result.erased }, message: 'Permanently deleted. Its sales history is kept.' }, 200);
  } catch (error) {
    logger.error('Product purge error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
