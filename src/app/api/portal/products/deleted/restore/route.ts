/**
 * POST /api/portal/products/deleted/restore
 * Body: { id: string }
 * Brings a product back with its stock, sizes and colours and movement history
 * — admins only. A shop it can't return to is reported in `skipped`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { restoreDeletedProduct } from '@/lib/product-restore.server';

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can restore a deleted product.' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return jsonResponse({ success: false, error: 'id is required' }, 400);

    const result = await restoreDeletedProduct(payload.organizationId as string, id);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return jsonResponse({ success: false, error: 'Product not found', code: result.code }, 404);
      }
      return jsonResponse({
        success: false,
        code: result.code,
        data: { skipped: result.skipped ?? [] },
        error: result.skipped?.length
          ? 'This product can’t go back: every shop it was in is closed, already stocks it, or has another product with the same SKU.'
          : 'No stock was saved for this product, because it was deleted before stock was being kept. Add it again as a new product.',
      }, 409);
    }

    await trackFromRequest(request, payload, {
      action: 'product.restore', category: 'product', resourceType: 'product', resourceId: id,
      details: { restoredShops: result.restored, skipped: result.skipped },
    });
    logger.info('Product restored', { productId: id, userId: payload.userId, shops: result.restored.length });

    return jsonResponse({
      success: true,
      data: { restored: result.restored, skipped: result.skipped },
      message: result.skipped.length > 0
        ? `Product restored to ${result.restored.length} shop(s). ${result.skipped.length} shop(s) couldn’t take it back.`
        : 'Product restored with its stock and history',
    }, 200);
  } catch (error) {
    logger.error('Product restore error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
