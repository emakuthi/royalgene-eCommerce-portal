import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * POST /api/mobile/shops/[shopId]/alerts/acknowledge-all
 * Mark all alerts for the shop as read
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const { error } = await supabaseAdmin
      .from('Alert')
      .update({ read: true, updatedAt: new Date().toISOString() })
      .eq('shopId', shopId)
      .eq('read', false);

    if (error) {
      logger.error('Mobile acknowledge all alerts error', { error: error.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to acknowledge alerts', code: 'INTERNAL_ERROR' }, 500);
    }

    logger.info('Mobile all alerts acknowledged', {
      userId: auth.payload.userId, shopId,
      endpoint: `/api/mobile/shops/${shopId}/alerts/acknowledge-all`,
    });

    return jsonResponse({ success: true, message: 'All alerts acknowledged' }, 200);
  } catch (error) {
    logger.error('Mobile acknowledge all alerts error', {
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
