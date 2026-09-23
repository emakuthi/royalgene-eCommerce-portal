/**
 * POST /api/mobile/sales/bulk-delete
 * Body: { saleIds: string[] }   (1–100 ids)
 *
 * Delete one or more sale line items — admins only, org-scoped (the
 * Android app's Sales History spans every shop the caller can see). Each
 * id is one SalesEntry row (one product, one size/colour cell when the
 * product is variant-tracked). Soft-deleted, recoverable from the portal's
 * Sales > Trash for 90 days, and the sold quantity is given back to the
 * shop it came from — see sale-delete.server.ts.
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { deleteSalesInOrg } from '@/lib/sale-delete.server';

const MAX_IDS = 100;

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;

    const organizationId = auth.payload.organizationId ?? null;
    if (!organizationId) {
      return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
    }
    if (!auth.isAdmin) {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete sales.', code: 'FORBIDDEN' }, 403);
    }

    const body = await request.json().catch(() => ({})) as { saleIds?: unknown };
    const saleIds = Array.isArray(body.saleIds) ? body.saleIds.filter((x): x is string => typeof x === 'string') : [];
    if (saleIds.length === 0) {
      return jsonResponse({ success: false, error: 'saleIds is required', code: 'VALIDATION_ERROR' }, 400);
    }
    if (saleIds.length > MAX_IDS) {
      return jsonResponse({ success: false, error: `Delete at most ${MAX_IDS} sales at a time`, code: 'VALIDATION_ERROR' }, 400);
    }

    const { data: portalUser } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', auth.payload.userId).maybeSingle();

    const outcome = await deleteSalesInOrg(organizationId, saleIds, portalUser?.id ?? null);

    logger.info('Mobile bulk sale delete', {
      userId: auth.payload.userId, organizationId, requested: saleIds.length,
      deleted: outcome.deleted.length, failed: outcome.failed.length,
    });

    return jsonResponse({
      success: outcome.deleted.length > 0 || outcome.failed.length === 0,
      data: outcome,
      message: `${outcome.deleted.length} removed`,
    }, outcome.deleted.length > 0 || outcome.failed.length === 0 ? 200 : 500);
  } catch (error) {
    logger.error('Mobile bulk sale delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
