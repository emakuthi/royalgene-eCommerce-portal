import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

/**
 * GET /api/portal/shops/[shopId]
 * Return a single shop by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

    const { data: shop, error } = await supabaseAdmin
      .from('Shop')
      .select('*')
      .eq('id', shopId)
      .maybeSingle();

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
 * Update a shop's details.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

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

    const { data: updated, error } = await supabaseAdmin
      .from('Shop')
      .update(updates)
      .eq('id', shopId)
      .select()
      .maybeSingle();

    if (error) {
      logger.error('Portal update shop failed', { shopId, error: error.message });
      return jsonResponse({ success: false, error: 'Failed to update shop' }, 500);
    }
    if (!updated) return jsonResponse({ success: false, error: 'Shop not found' }, 404);

    logger.info('Portal shop updated', { shopId, userId: payload.userId });
    return jsonResponse({ success: true, data: updated }, 200);
  } catch (err) {
    logger.error('Portal update shop error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}

