import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

/**
 * GET /api/portal/shops/[shopId]
 * Return a single shop by ID, scoped to the caller's organization.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await params;
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin.from('Shop').select('*').eq('id', shopId);
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);
    const { data: shop, error } = await query.maybeSingle();

    if (error) {
      logger.error('Portal get shop failed', { shopId, error: error.message });
      return jsonResponse({ success: false, error: 'Failed to fetch shop' }, 500);
    }
    if (!shop) return jsonResponse({ success: false, error: 'Shop not found' }, 404);

    return jsonResponse({ success: true, data: shop }, 200);
  } catch (err) {
    logger.error('Portal get shop error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

/**
 * PATCH /api/portal/shops/[shopId]
 * Update a shop's details, scoped to the caller's organization.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await params;
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json() as Record<string, unknown>;
    const allowedFields = ['name', 'location', 'phone', 'email', 'manager', 'description', 'isActive'];
    const updates: Record<string, unknown> = {};
    for (const k of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, k)) updates[k] = body[k];
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, error: 'No updatable fields provided' }, 400);
    }

    updates.updatedAt = new Date().toISOString();

    let query = supabaseAdmin.from('Shop').update(updates).eq('id', shopId);
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);
    const { data: updated, error } = await query.select().maybeSingle();

    if (error) {
      logger.error('Portal update shop failed', { shopId, error: error.message });
      return jsonResponse({ success: false, error: 'Failed to update shop' }, 500);
    }
    if (!updated) return jsonResponse({ success: false, error: 'Shop not found' }, 404);

    logger.info('Portal shop updated', { shopId, userId: auth.userId });
    return jsonResponse({ success: true, data: updated }, 200);
  } catch (err) {
    logger.error('Portal update shop error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

/**
 * DELETE /api/portal/shops/[shopId]
 * Soft-deletes the shop (isActive=false, deletedAt=now) rather than removing
 * the row — Shop is a synced entity (Android's offline cache tombstones a
 * row via `deletedAt`, not by it disappearing from a hard DELETE) and a real
 * DELETE would also hit the FK from every ShopStock/SalesEntry/
 * StockTransaction/PortalUser row still pointing at it. Admin (or
 * super_admin) only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await params;
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.role !== 'admin' && auth.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Admin access required' }, 403);
    }

    let existingQuery = supabaseAdmin.from('Shop').select('id, isActive, deletedAt').eq('id', shopId);
    if (auth.organizationId) existingQuery = existingQuery.eq('organizationId', auth.organizationId);
    const { data: existing, error: fetchError } = await existingQuery.maybeSingle();

    if (fetchError) {
      logger.error('Portal delete shop lookup failed', { shopId, error: fetchError.message });
      return jsonResponse({ success: false, error: 'Failed to fetch shop' }, 500);
    }
    if (!existing) return jsonResponse({ success: false, error: 'Shop not found' }, 404);
    if (existing.deletedAt || !existing.isActive) {
      return jsonResponse({ success: false, error: 'Shop is already deleted' }, 409);
    }

    // Refuse to leave an organization with zero shops — product creation,
    // sales, and the mobile app's "All Shops" view all assume at least one
    // active shop exists.
    let remainingQuery = supabaseAdmin
      .from('Shop')
      .select('id', { count: 'exact', head: true })
      .eq('isActive', true)
      .neq('id', shopId);
    if (auth.organizationId) remainingQuery = remainingQuery.eq('organizationId', auth.organizationId);
    const { count: remaining, error: countError } = await remainingQuery;

    if (countError) {
      logger.error('Portal delete shop count failed', { shopId, error: countError.message });
      return jsonResponse({ success: false, error: 'Failed to verify remaining shops' }, 500);
    }
    if (!remaining) {
      return jsonResponse({ success: false, error: 'Cannot delete the only remaining shop — create another shop first' }, 400);
    }

    const now = new Date().toISOString();
    const { data: deleted, error } = await supabaseAdmin
      .from('Shop')
      .update({ isActive: false, deletedAt: now, updatedAt: now })
      .eq('id', shopId)
      .select()
      .maybeSingle();

    if (error) {
      logger.error('Portal delete shop failed', { shopId, error: error.message });
      return jsonResponse({ success: false, error: 'Failed to delete shop' }, 500);
    }

    logger.info('Portal shop deleted', { shopId, userId: auth.userId });
    return jsonResponse({ success: true, data: deleted });
  } catch (err) {
    logger.error('Portal delete shop error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
