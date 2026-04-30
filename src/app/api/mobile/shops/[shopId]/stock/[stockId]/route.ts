import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';

/**
 * PUT /api/mobile/shops/[shopId]/stock/[stockId]
 * Update stock quantity for a specific shop stock item
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ shopId: string; stockId: string }> }
) {
  const startTime = Date.now();

  try {
    const { shopId, stockId } = await context.params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return jsonResponse({
        success: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({
        success: false,
        error: 'Invalid token',
        code: 'UNAUTHORIZED',
      }, 401);
    }

    // Verify user has access to this shop
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .eq('shopId', shopId)
      .single();

    if (portalError || !portalUser) {
      logger.warn('Mobile stock update access denied', {
        userId: payload.userId,
        shopId,
        stockId,
        endpoint: `/api/mobile/shops/${shopId}/stock/${stockId}`,
      });
      return jsonResponse({
        success: false,
        error: 'Forbidden',
        code: 'FORBIDDEN',
      }, 403);
    }

    const { quantity, reason } = await request.json();

    if (quantity === undefined || quantity === null) {
      return jsonResponse({
        success: false,
        error: 'Quantity is required',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    if (typeof quantity !== 'number' || quantity < 0) {
      return jsonResponse({
        success: false,
        error: 'Quantity must be a non-negative number',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    // Get current stock – must belong to the specified shop
    const { data: currentStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('id', stockId)
      .eq('shopId', shopId)
      .single();

    if (stockError || !currentStock) {
      return jsonResponse({
        success: false,
        error: 'Stock item not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Update stock
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('ShopStock')
      .update({
        quantity,
        lastRestockDate: now,
        lastRestockBy: portalUser.id,
        updatedAt: now,
      })
      .eq('id', stockId)
      .select()
      .single();

    if (updateError) {
      logger.error('Mobile stock update DB error', {
        error: updateError.message,
        stockId,
        shopId,
        endpoint: `/api/mobile/shops/${shopId}/stock/${stockId}`,
      });
      return jsonResponse({
        success: false,
        error: 'Failed to update stock',
        code: 'INTERNAL_ERROR',
      }, 500);
    }

    // Create transaction record
    await supabaseAdmin
      .from('StockTransaction')
      .insert([{
        id: uuidv4(),
        shopStockId: stockId,
        portalUserId: portalUser.id,
        type: 'adjustment',
        quantity: quantity - (currentStock.quantity || 0),
        reason: reason || 'Mobile adjustment',
        createdAt: now,
      }]);

    const duration = Date.now() - startTime;
    logger.info('Mobile stock updated', {
      userId: payload.userId,
      shopId,
      stockId,
      oldQuantity: currentStock.quantity,
      newQuantity: quantity,
      duration,
      endpoint: `/api/mobile/shops/${shopId}/stock/${stockId}`,
    });

    return jsonResponse({
      success: true,
      data: updated,
      message: 'Stock updated successfully',
    }, 200);
  } catch (error) {
    logger.error('Mobile stock update error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/stock/[stockId]',
    });
    return jsonResponse({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
}

/** OPTIONS handler for CORS */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

