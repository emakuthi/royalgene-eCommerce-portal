import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const stockId = id;
    const { quantity, reason } = await request.json();

    if (quantity === undefined) {
      return jsonResponse({ success: false, error: 'Quantity required' }, 400);
    }

    // Get portal user
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .single();

    if (portalError || !portalUser) {
      return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
    }

    // Get current stock
    const { data: currentStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('id', stockId)
      .single();

    if (stockError || !currentStock) {
      return jsonResponse({ success: false, error: 'Stock not found' }, 404);
    }

    if (currentStock.shopId !== portalUser.shopId) {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
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
      throw new Error(updateError.message);
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
        reason: reason || 'Manual adjustment',
        createdAt: now,
      }]);

    return jsonResponse({ success: true, data: updated }, 200);
  } catch (error) {
    console.error('Stock update error:', error);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PUT,OPTIONS');
}
