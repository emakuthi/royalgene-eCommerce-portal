import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth.server';
import { rejectIfDeactivated } from '@/lib/deactivated-staff.server';
import { isShopNameAvailable } from '@/lib/shops.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

const MAX_NAME_LENGTH = 100;

/**
 * PATCH /api/mobile/shops/[shopId]
 * Body: { name: string }
 *
 * Renames a shop. Workspace admins only, like creating one. The sync metadata
 * trigger bumps the row, so the new name reaches every phone on its next sync.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> },
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);
    const deactivated = await rejectIfDeactivated(payload);
    if (deactivated) return deactivated;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can rename shops', code: 'FORBIDDEN' }, 403);
    }
    if (!payload.organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required to rename a shop', code: 'NO_ORGANIZATION' }, 400);
    }
    const organizationId = payload.organizationId;

    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
      return jsonResponse({ success: false, error: `Shop name must be 2 to ${MAX_NAME_LENGTH} characters`, code: 'VALIDATION_ERROR' }, 400);
    }

    const { shopId } = await context.params;
    const { data: shop, error: lookupError } = await supabaseAdmin
      .from('Shop')
      .select('id, name')
      .eq('id', shopId)
      .eq('organizationId', organizationId)
      .eq('isActive', true)
      .maybeSingle();
    if (lookupError) {
      logger.error('Mobile rename shop lookup failed', { shopId, error: lookupError.message });
      return jsonResponse({ success: false, error: 'Failed to rename shop', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!shop) return jsonResponse({ success: false, error: 'Shop not found', code: 'NOT_FOUND' }, 404);

    // Changing only the capitals of its own name isn't a clash with itself.
    const sameName = String(shop.name).toLowerCase() === name.toLowerCase();
    if (!sameName && !(await isShopNameAvailable(name, organizationId))) {
      return jsonResponse({ success: false, error: 'A shop with that name already exists', code: 'DUPLICATE_NAME' }, 409);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('Shop')
      .update({ name, updatedAt: new Date().toISOString() })
      .eq('id', shopId)
      .eq('organizationId', organizationId)
      .select('id, name, location, phone, address')
      .maybeSingle();
    if (updateError) {
      if (updateError.code === '23505') {
        return jsonResponse({ success: false, error: 'A shop with that name already exists', code: 'DUPLICATE_NAME' }, 409);
      }
      logger.error('Mobile rename shop failed', { shopId, error: updateError.message });
      return jsonResponse({ success: false, error: 'Failed to rename shop', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!updated) return jsonResponse({ success: false, error: 'Shop not found', code: 'NOT_FOUND' }, 404);

    logger.info('Mobile shop renamed', { shopId, userId: payload.userId });
    return jsonResponse({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        location: updated.location,
        phoneNumber: updated.phone ?? null,
        address: updated.address ?? null,
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile rename shop error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
