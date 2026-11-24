import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { hasCapability } from '@/lib/permissions.server';
import { handleArchiveRequest } from '@/lib/product-archive.server';
import logger from '@/lib/logger';

/**
 * POST /api/mobile/products/{productId}/archive   { archived: boolean }
 * Same as the portal route: archive an out-of-stock product, or bring it back. Admins only.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;
    const orgId = auth.payload.organizationId;
    if (!orgId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
    if (!auth.isAdmin || !(await hasCapability(auth.payload, 'edit_inventory'))) {
      return jsonResponse({ success: false, error: 'Only workspace admins can archive products.', code: 'FORBIDDEN' }, 403);
    }
    const { productId } = await context.params;
    return await handleArchiveRequest(request, auth.payload, orgId, productId);
  } catch (error) {
    logger.error('Mobile product archive error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
