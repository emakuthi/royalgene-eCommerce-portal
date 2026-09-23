/**
 * POST /api/portal/sales/trash/restore
 * Body: { id: string }
 * Bring a soft-deleted sale back — admins only. Re-applies its stock effect
 * (undoing the restock the delete did), so this can fail with
 * INSUFFICIENT_STOCK if that stock has since been sold or moved elsewhere.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { restoreSaleFromTrash } from '@/lib/sale-delete.server';

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can restore a deleted sale.' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return jsonResponse({ success: false, error: 'id is required' }, 400);

    const { data: portalUser } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', payload.userId).maybeSingle();
    const result = await restoreSaleFromTrash(payload.organizationId as string, id, portalUser?.id ?? null);

    if (!result.ok) {
      return jsonResponse({ success: false, error: result.error, code: result.code }, result.code === 'NOT_FOUND' ? 404 : 409);
    }

    void trackFromRequest(request, payload, { action: 'sale.restore', category: 'sale', resourceType: 'SalesEntry', resourceId: id });
    logger.info('Sale restored from trash', { saleId: id, userId: payload.userId });

    return jsonResponse({ success: true, message: 'Sale restored' }, 200);
  } catch (error) {
    logger.error('Sale restore error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
