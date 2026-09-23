/**
 * POST /api/portal/sales/bulk-delete
 * Body: { saleIds: string[] }   (1–100 ids)
 *
 * Delete one or more sale LINE ITEMS — admins only. Each id is one
 * SalesEntry row (one product, one size/colour cell when variant-tracked);
 * a multi-item checkout has no separate "sale" row to delete, so removing a
 * whole checkout just means passing every one of its line ids. Soft-deleted
 * (recoverable from Sales > Trash for 90 days — see sale-delete.server.ts),
 * and the sold quantity is given back to the shop it came from.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { deleteSalesInOrg } from '@/lib/sale-delete.server';

const MAX_IDS = 100;

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete sales.' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { saleIds?: unknown };
    const saleIds = Array.isArray(body.saleIds) ? body.saleIds.filter((x): x is string => typeof x === 'string') : [];
    if (saleIds.length === 0) {
      return jsonResponse({ success: false, error: 'saleIds is required' }, 400);
    }
    if (saleIds.length > MAX_IDS) {
      return jsonResponse({ success: false, error: `Delete at most ${MAX_IDS} sales at a time` }, 400);
    }

    const { data: portalUser } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', payload.userId).maybeSingle();

    const outcome = await deleteSalesInOrg(payload.organizationId as string, saleIds, portalUser?.id ?? null);

    void trackFromRequest(request, payload, {
      action: 'sale.bulk_delete', category: 'sale',
      details: { requested: saleIds.length, deleted: outcome.deleted.length, failed: outcome.failed.length },
    });

    logger.info('Portal bulk sale delete', {
      userId: payload.userId, organizationId: payload.organizationId, requested: saleIds.length,
      deleted: outcome.deleted.length, failed: outcome.failed.length,
    });

    return jsonResponse({
      success: outcome.deleted.length > 0 || outcome.failed.length === 0,
      data: outcome,
      message: `${outcome.deleted.length} removed`,
    }, outcome.deleted.length > 0 || outcome.failed.length === 0 ? 200 : 500);
  } catch (error) {
    logger.error('Portal bulk sale delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
