import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const stockId = id;
    const { quantity, reason } = await request.json();

    if (quantity === undefined) {
      return jsonResponse({ success: false, error: 'Quantity required' }, 400);
    }

    // Get current stock (with its organization, via the owning shop)
    const { data: currentStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('id', stockId)
      .single();

    if (stockError || !currentStock) {
      return jsonResponse({ success: false, error: 'Stock not found' }, 404);
    }

    // Even an "admin" role is org-scoped — verify this stock's own
    // organizationId matches the caller's before allowing any update.
    if (payload.organizationId && currentStock.organizationId !== payload.organizationId) {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Resolve portal user: admins act on any shop in their org (already
    // verified above); regular portal users must be assigned to this shop.
    let portalUserId: string;
    if (payload.role === 'admin' || payload.role === 'super_admin') {
      portalUserId = `admin-${payload.userId}`;
    } else {
      const { data: portalUser, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('userId', payload.userId)
        .single();

      if (portalError || !portalUser) {
        return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
      }
      if (currentStock.shopId !== portalUser.shopId) {
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
      portalUserId = portalUser.id;
    }

    // Update stock
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('ShopStock')
      .update({
        quantity,
        lastRestockDate: now,
        lastRestockBy: portalUserId,
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
        organizationId: currentStock.organizationId,
        shopStockId: stockId,
        portalUserId,
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
