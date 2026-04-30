import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * POST /api/mobile/shops/[shopId]/alerts/[alertId]/acknowledge
 * Mark a single alert as read
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; alertId: string }> }
) {
  try {
    const { shopId, alertId } = await context.params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);
    }

    // Verify shop access
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('id, shopId')
      .eq('userId', payload.userId)
      .eq('shopId', shopId)
      .single();

    if (portalError || !portalUser) {
      return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const { data, error } = await supabaseAdmin
      .from('Alert')
      .update({ read: true, updatedAt: new Date().toISOString() })
      .eq('id', alertId)
      .eq('shopId', shopId)
      .select()
      .single();

    if (error || !data) {
      return jsonResponse({ success: false, error: 'Alert not found', code: 'NOT_FOUND' }, 404);
    }

    logger.info('Mobile alert acknowledged', {
      userId: payload.userId, shopId, alertId,
      endpoint: `/api/mobile/shops/${shopId}/alerts/${alertId}/acknowledge`,
    });

    return jsonResponse({ success: true, data }, 200);
  } catch (error) {
    logger.error('Mobile alert acknowledge error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
