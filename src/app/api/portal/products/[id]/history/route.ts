import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { buildProductHistory } from '@/lib/product-history.server';
import logger from '@/lib/logger';

/**
 * GET /api/portal/products/[id]/history
 * Product activity timeline (created, sales, restocks, adjustments, transfers,
 * field edits), org-scoped to the caller's tenant.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    if (!auth.organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required' }, 400);
    }

    const { id } = await context.params;
    const events = await buildProductHistory(auth.organizationId, id);
    if (events === null) {
      return jsonResponse({ success: false, error: 'Product not found' }, 404);
    }
    return jsonResponse({ success: true, data: { events } });
  } catch (error) {
    logger.error('Portal product history error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
