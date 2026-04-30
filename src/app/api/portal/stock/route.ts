import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { updateShopStock, recordStockTransaction } from '@/lib/db';
import type { StockTransaction, PortalUser, ShopStock } from '@/lib/types';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      logger.warn('Stock fetch unauthorized: no token', { endpoint: '/api/portal/stock', method: 'GET' });
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      logger.warn('Stock fetch unauthorized: invalid token', { endpoint: '/api/portal/stock' });
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');

    logger.info('Fetching shop stock', { shopId, userId: payload.userId, endpoint: '/api/portal/stock', method: 'GET' });

    if (!shopId) {
      logger.warn('Stock fetch failed: shop ID required', { endpoint: '/api/portal/stock' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // Fetch shop stocks with product information
    // Note: Try to order by updatedAt for consistency, but fall back to createdAt if updatedAt doesn't exist
    const query = supabaseAdmin
      .from('ShopStock')
      .select('*, Product!ShopStock_productId_fkey(*)')
      .eq('shopId', shopId);

    // Try to order by updatedAt first
    try {
      const { data: stocks, error } = await query.order('updatedAt', { ascending: false });

      if (error && error.message && error.message.includes('updatedAt')) {
        // If updatedAt column doesn't exist, fall back to createdAt
        logger.warn('updatedAt column not found on ShopStock, falling back to createdAt ordering', { shopId });
        const { data: fallbackStocks, error: fallbackError } = await supabaseAdmin
          .from('ShopStock')
          .select('*, Product!ShopStock_productId_fkey(*)')
          .eq('shopId', shopId)
          .order('createdAt', { ascending: false });

        if (fallbackError) {
          throw new Error(fallbackError.message);
        }

        logger.info('Shop stock fetched successfully (with fallback)', {
          shopId,
          count: fallbackStocks?.length || 0,
          userId: payload.userId,
          endpoint: '/api/portal/stock',
          duration: Date.now() - startTime
        });

        return jsonResponse({ success: true, data: fallbackStocks || [] }, 200);
      }

      if (error) {
        throw new Error(error.message);
      }

      logger.info('Shop stock fetched successfully', {
        shopId,
        count: stocks?.length || 0,
        userId: payload.userId,
        endpoint: '/api/portal/stock',
        duration: Date.now() - startTime
      });

      return jsonResponse({ success: true, data: stocks || [] }, 200);
    } catch (error) {
      // If ordering fails for any reason, try without ordering
      logger.warn('Stock fetch with ordering failed, retrying without ordering', {
        error: error instanceof Error ? error.message : String(error),
      });

      const { data: stocks, error: fallbackError } = await supabaseAdmin
        .from('ShopStock')
        .select('*, Product!ShopStock_productId_fkey(*)')
        .eq('shopId', shopId);

      if (fallbackError) {
        throw new Error(fallbackError.message);
      }

      logger.info('Shop stock fetched successfully (without ordering)', {
        shopId,
        count: stocks?.length || 0,
        userId: payload.userId,
        endpoint: '/api/portal/stock',
        duration: Date.now() - startTime
      });

      return jsonResponse({ success: true, data: stocks || [] }, 200);
    }
  } catch (error) {
    logger.error('Stock fetch error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/stock',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function PUT(request: NextRequest) {
  const startTime = Date.now();

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const { stockId, quantity, reason } = await request.json();

    if (!stockId || quantity === undefined) {
      return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
    }

    // Fetch old stock first to resolve shopId (needed to authorize/admin actions)
    const { data: oldStock, error: stockError } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('id', stockId)
      .single();

    if (stockError || !oldStock) {
      return jsonResponse({ success: false, error: 'Stock not found' }, 404);
    }

    // Resolve portal user: allow admins/super_admin to act by synthesizing a minimal portalUser tied to the stock's shop
    let portalUser: PortalUser | null = null;
    const oldStockTyped = oldStock as ShopStock;
    if (payload.role === 'admin' || payload.role === 'super_admin') {
      portalUser = {
        id: `admin-${payload.userId}`,
        userId: payload.userId,
        shopId: oldStockTyped.shopId,
        position: 'shop_manager',
        isActive: true,
        mobileAccess: true,
        lastLogin: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as PortalUser;
    } else {
      const { data: pUser, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('userId', payload.userId)
        .single();

      if (portalError || !pUser) {
        return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
      }
      portalUser = pUser as PortalUser;
    }

    if (oldStockTyped.shopId !== portalUser.shopId) {
      logger.warn('Stock update forbidden: user not assigned to shop', { userId: payload.userId, shopId: oldStockTyped.shopId, userShop: portalUser.shopId, endpoint: '/api/portal/stock' });
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Update stock
    try {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('ShopStock')
        .update({
          quantity,
          lastRestockDate: new Date().toISOString(),
          lastRestockBy: portalUser.id,
          updatedAt: new Date().toISOString(),
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
          quantity: quantity - (oldStock.quantity || 0),
          reason: reason || 'Manual adjustment',
          createdAt: new Date().toISOString(),
        }]);

      // Sync aggregated product stockQuantity so storefront reflects portal changes
      try {
        const prodId = (oldStock as unknown as { productId?: string }).productId;
        if (prodId) await syncProductStockFromShopStocks(prodId);
      } catch (syncErr) {
        logger.warn('Failed to sync product stock after ShopStock update', { error: syncErr instanceof Error ? syncErr.message : String(syncErr) });
      }

      // Track stock update activity
      void trackFromRequest(request, payload, {
        action: 'stock.update', category: 'stock',
        resourceType: 'ShopStock', resourceId: stockId,
        details: { quantity, reason, previousQuantity: oldStock?.quantity },
      });

      return jsonResponse({ success: true, data: updated }, 200);
    } catch (err) {
      // Fallback to in-memory DB
      logger.warn('Supabase update failed, falling back to in-memory DB', { error: err instanceof Error ? err.message : String(err) });

      // Only allow fallback for admins or super_admins
      if (payload.role !== 'admin' && payload.role !== 'super_admin') {
        return jsonResponse({ success: false, error: 'Failed to update stock' }, 500);
      }

      const updated = updateShopStock(stockId, {
        quantity,
        lastRestockDate: new Date().toISOString(),
        lastRestockBy: portalUser?.id || payload.userId,
      });

      // create transaction record in-memory
      const tx: Partial<StockTransaction> = {
        id: uuidv4(),
        shopStockId: stockId,
        portalUserId: portalUser?.id || payload.userId,
        // ensure this matches the StockTransaction.type union
        type: 'adjustment',
        quantity: quantity - (oldStock.quantity || 0),
        reason: reason || 'Manual adjustment',
        createdAt: new Date().toISOString(),
      };
      recordStockTransaction(tx);

      // Attempt to sync product stock even for fallback (best-effort)
      try {
        const prodId = (oldStock as unknown as { productId?: string }).productId;
        if (prodId) await syncProductStockFromShopStocks(prodId);
      } catch (syncErr) {
        logger.warn('Failed to sync product stock after in-memory ShopStock update', { error: syncErr instanceof Error ? syncErr.message : String(syncErr) });
      }

      return jsonResponse({ success: true, data: updated }, 200);
    }
  } catch (error) {
    logger.error('Stock update error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/stock',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
