import { applySaleEdit, canEditSale, NOT_YOUR_SALE } from '@/lib/sale-edit.server';
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { deleteSalesInOrg } from '@/lib/sale-delete.server';

async function saleIdFrom(context: unknown): Promise<string | undefined> {
  const resolved = await Promise.resolve(context as unknown);
  // Next 15 passes params as a Promise (sync property access is only a
  // deprecated fallback) — await it rather than reading it directly.
  const params = resolved && typeof resolved === 'object' ? await (resolved as Record<string, unknown>)['params'] : undefined;
  const id = params && typeof params === 'object' ? (params as Record<string, unknown>)['id'] : undefined;
  return typeof id === 'string' ? id : undefined;
}

/**
 * GET /api/portal/sales/[id]
 * One sale line item, for the edit form's prefill (/sales/new?saleId=…).
 * Same access rule as PATCH: same org, and the caller's own shop unless admin.
 * Adds shopStockId (not a SalesEntry column) — the form selects by stock row —
 * and canEdit, so the form opens read-only on a sale the caller may not change.
 */
export async function GET(request: NextRequest, context: unknown) {
  try {
    const saleId = await saleIdFrom(context);
    if (!saleId) return jsonResponse({ success: false, error: 'Missing sale id' }, 400);

    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const { data: sale } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('id', saleId)
      .is('deletedAt', null)
      .maybeSingle();
    if (!sale || (payload.organizationId && sale.organizationId !== payload.organizationId)) {
      return jsonResponse({ success: false, error: 'Sale not found' }, 404);
    }

    const { data: portalUser } = await supabaseAdmin
      .from('PortalUser')
      .select('shopId')
      .eq('userId', payload.userId)
      .maybeSingle();
    if (!portalUser) return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
    if (portalUser.shopId !== sale.shopId && payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    const { data: stock } = await supabaseAdmin
      .from('ShopStock')
      .select('id')
      .eq('shopId', sale.shopId)
      .eq('productId', sale.productId)
      .maybeSingle();

    const canEdit = await canEditSale(payload, sale);
    return jsonResponse({ success: true, data: { ...sale, shopStockId: stock?.id ?? null, canEdit } }, 200);
  } catch (error) {
    logger.error('Portal sale fetch error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

/**
 * DELETE /api/portal/sales/[id]
 * Delete one sale line item — admins only. See POST /api/portal/sales/bulk-delete
 * for the multi-select form (this is just that with a single id).
 */
export async function DELETE(request: NextRequest, context: unknown) {
  try {
    const resolvedContext = await Promise.resolve(context as unknown);
    let saleId: string | undefined;
    if (resolvedContext && typeof resolvedContext === 'object') {
      const params = (resolvedContext as Record<string, unknown>)['params'];
      if (params && typeof params === 'object') {
        const idVal = (params as Record<string, unknown>)['id'];
        if (typeof idVal === 'string') saleId = idVal;
      }
    }
    if (!saleId) return jsonResponse({ success: false, error: 'Missing sale id' }, 400);

    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can delete sales.' }, 403);
    }

    const { data: portalUser } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', payload.userId).maybeSingle();
    const outcome = await deleteSalesInOrg(payload.organizationId as string, [saleId], portalUser?.id ?? null);

    if (outcome.notFound.length > 0) {
      return jsonResponse({ success: false, error: 'Sale not found' }, 404);
    }
    if (outcome.failed.length > 0) {
      return jsonResponse({ success: false, error: outcome.failed[0].error || 'Failed to delete sale' }, 500);
    }

    void trackFromRequest(request, payload, { action: 'sale.delete', category: 'sale', resourceType: 'SalesEntry', resourceId: saleId });
    logger.info('Sale deleted', { saleId, userId: payload.userId });

    return jsonResponse({ success: true, message: 'Sale deleted' }, 200);
  } catch (error) {
    logger.error('Sale delete error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

// Use `unknown` for the context and perform a type-safe normalization below.
export async function PATCH(request: NextRequest, context: unknown) {
  const start = Date.now();
  try {
    // Next.js typing can sometimes provide params wrapped in a Promise or as a plain object.
    // Resolve `context` safely and extract `params.id` with runtime checks (no `any`).
    const resolvedContext = await Promise.resolve(context as unknown);
    let saleId: string | undefined = undefined;
    if (resolvedContext && typeof resolvedContext === 'object') {
      const ctxObj = resolvedContext as Record<string, unknown>;
      const params = ctxObj['params'];
      if (params && typeof params === 'object') {
        const paramsObj = params as Record<string, unknown>;
        const idVal = paramsObj['id'];
        if (typeof idVal === 'string') saleId = idVal;
      }
    }
    if (!saleId) return jsonResponse({ success: false, error: 'Missing sale id' }, 400);

    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const body = await request.json().catch(() => ({}));

    // Fetch existing sale
    const { data: existingSale, error: saleErr } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('id', saleId)
      .is('deletedAt', null)
      .single();

    if (saleErr || !existingSale) {
      return jsonResponse({ success: false, error: 'Sale not found' }, 404);
    }

    // Even an "admin" role is org-scoped — this must be checked before the
    // admin-bypass below, otherwise an org admin could update another
    // tenant's sale simply by knowing/guessing its id.
    if (payload.organizationId && existingSale.organizationId !== payload.organizationId) {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Verify portal user permissions: the token user must be the portalUser or an admin
    const { data: portalUser } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .single();

    if (!portalUser) return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
    if (portalUser.shopId !== existingSale.shopId && payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    if (!(await canEditSale(payload, existingSale))) {
      return jsonResponse({ success: false, error: NOT_YOUR_SALE }, 403);
    }

    const result = await applySaleEdit(existingSale, body, portalUser.id ?? null);
    if (!result.ok) return jsonResponse({ success: false, error: result.error }, result.status);
    const updatedSale = result.sale;

    logger.info('Sales entry updated', { saleId, userId: payload.userId, duration: Date.now() - start });

    return jsonResponse({ success: true, data: updatedSale }, 200);
  } catch (err) {
    logger.error('Sales update error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
