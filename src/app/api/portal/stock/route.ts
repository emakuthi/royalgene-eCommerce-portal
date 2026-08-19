import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
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
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const fetchAll = searchParams.get('all') === 'true';

    logger.info('Fetching shop stock', { shopId, fetchAll, userId: payload.userId, endpoint: '/api/portal/stock', method: 'GET' });

    // If fetchAll=true (admin/super_admin only), return stock for every shop with shop name enrichment.
    // "admin" is an org-scoped role — they only ever see their own organization's shops/stock.
    // Only "super_admin" (organizationId === null, platform-level) gets truly cross-tenant results.
    if (fetchAll) {
      if (payload.role !== 'admin' && payload.role !== 'super_admin') {
        return jsonResponse({ success: false, error: 'Forbidden: admin access required for all-shops stock' }, 403);
      }

      let shopsQuery = supabaseAdmin.from('Shop').select('id, name').eq('isActive', true);
      if (payload.organizationId) shopsQuery = shopsQuery.eq('organizationId', payload.organizationId);
      const { data: shops, error: shopsErr } = await shopsQuery;
      if (shopsErr) {
        logger.error('All-stock fetch: failed to load shops', { error: shopsErr.message });
        return jsonResponse({ success: false, error: 'Failed to fetch shops' }, 500);
      }
      const shopNameMap: Record<string, string> = {};
      for (const s of (shops ?? [])) shopNameMap[s.id as string] = s.name as string;
      const shopIds = (shops ?? []).map((s) => s.id as string);

      let allStocksQuery = supabaseAdmin
        .from('ShopStock')
        .select('*, Product!ShopStock_productId_fkey(*)')
        .order('createdAt', { ascending: false });
      // Scope to the organization's own shops even for super_admin's org-agnostic
      // path — an org admin's shop list already IS the scope; for super_admin
      // (no organizationId) this is intentionally left unfiltered.
      if (payload.organizationId) allStocksQuery = allStocksQuery.in('shopId', shopIds.length > 0 ? shopIds : ['__none__']);
      const { data: allStocks, error: allErr } = await allStocksQuery;

      if (allErr) {
        logger.error('All-stock fetch failed', { error: allErr.message });
        return jsonResponse({ success: false, error: 'Failed to fetch all stock' }, 500);
      }

      const enriched = (allStocks ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        shopName: shopNameMap[row.shopId as string] ?? null,
      }));

      return jsonResponse({ success: true, data: enriched }, 200);
    }

    if (!shopId) {
      logger.warn('Stock fetch failed: shop ID required', { endpoint: '/api/portal/stock' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // Verify the requested shop actually belongs to the caller's organization
    // before returning anything — prevents fetching another tenant's stock by
    // simply passing their shopId (super_admin exempt, matching other routes).
    if (payload.organizationId) {
      const { data: shopCheck } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('id', shopId)
        .eq('organizationId', payload.organizationId)
        .maybeSingle();
      if (!shopCheck) {
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
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
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

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

    const oldStockTyped = oldStock as ShopStock;

    // Even an "admin" role is org-scoped — verify the stock's shop actually
    // belongs to this caller's organization before allowing any admin-path
    // update (super_admin, with no organizationId, is exempt).
    if (payload.organizationId) {
      const { data: shopCheck } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('id', oldStockTyped.shopId)
        .eq('organizationId', payload.organizationId)
        .maybeSingle();
      if (!shopCheck) {
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
    }

    // Resolve portal user: allow admins/super_admin to act by synthesizing a minimal portalUser tied to the stock's shop
    let portalUser: PortalUser | null = null;
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
          organizationId: oldStock.organizationId,
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
