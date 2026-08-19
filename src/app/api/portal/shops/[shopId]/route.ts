import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
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
    const auth = requireAuth(request);
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
    const auth = requireAuth(request);
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

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
