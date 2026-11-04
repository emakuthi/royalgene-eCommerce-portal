/**
 * GET /api/portal/products/deleted
 * Products that were deleted, or removed from a shop, and what Restore would
 * bring back — admins only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listDeletedProducts } from '@/lib/product-restore.server';

export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can view deleted products.' }, 403);
    }

    const products = await listDeletedProducts(payload.organizationId as string);
    return jsonResponse({ success: true, data: { products } }, 200);
  } catch (error) {
    logger.error('Deleted products list error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
