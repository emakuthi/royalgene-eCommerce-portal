import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

/**
 * GET /api/mobile/shops/[shopId]/alerts/count
 * Get unread alert count for the shop
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    const { count, error } = await supabaseAdmin
      .from('Alert')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shopId)
      .eq('read', false);

    if (error) {
      logger.error('Mobile alert count error', { error: error.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to get alert count', code: 'INTERNAL_ERROR' }, 500);
    }

    return jsonResponse({
      success: true,
      data: { count: typeof count === 'number' ? count : 0 },
    }, 200);
  } catch (error) {
    logger.error('Mobile alert count error', {
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
