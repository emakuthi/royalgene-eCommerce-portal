import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import type { ShopStock, PortalUser as PortalUserType } from '@/lib/types';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      logger.warn('Sales entry unauthorized: no token', { endpoint: '/api/portal/sales', method: 'POST' });
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      logger.warn('Sales entry unauthorized: invalid token', { endpoint: '/api/portal/sales' });
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const {
      shopId: payloadShopId,
      shopStockId,
      productId: payloadProductId,
      quantity,
      unitPrice,
      paymentMethod,
      customerName,
      customerPhone,
      notes,
    } = await request.json();

    logger.info('Sales entry attempt', { shopStockId: shopStockId || null, shopId: payloadShopId, productId: payloadProductId, quantity, userId: payload.userId, endpoint: '/api/portal/sales' });

    // Validate input: require quantity and unitPrice, and either shopStockId OR both shopId and productId
    if (!quantity || !unitPrice || (!(shopStockId) && (!payloadShopId || !payloadProductId))) {
      logger.warn('Sales entry failed: missing fields', { shopStockId: shopStockId || null, shopId: payloadShopId || null, productId: payloadProductId || null, userId: payload.userId, endpoint: '/api/portal/sales' });
      return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
    }

    // Get portal user
    // For admin/super_admin, find an actual PortalUser for the shop
    let portalUser: PortalUserType | null = null;
    let effectiveShopId: string | null = null;

    if (payload.role === 'super_admin' || payload.role === 'admin') {
      // Resolve effective shopId if not provided but shopStockId is present
      effectiveShopId = payloadShopId;
      if (!effectiveShopId && shopStockId) {
        const { data: stockRow, error: stockErr } = await supabaseAdmin
          .from('ShopStock')
          .select('shopId')
          .eq('id', shopStockId)
          .single();

        if (stockErr || !stockRow) {
          logger.warn('Sales entry failed: cannot resolve shop for admin action', { shopStockId, userId: payload.userId, endpoint: '/api/portal/sales' });
          return jsonResponse({ success: false, error: 'Shop stock not found' }, 404);
        }

        effectiveShopId = stockRow.shopId;
      }

      if (!effectiveShopId) {
        logger.warn('Sales entry failed: admin action requires shopId', { userId: payload.userId, endpoint: '/api/portal/sales' });
        return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
      }

      // Find an actual PortalUser for this shop to use as the portalUserId
      const { data: shopPortalUser, error: shopPortalError } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('shopId', effectiveShopId)
        .limit(1)
        .single();

      if (shopPortalError || !shopPortalUser) {
        logger.warn('Sales entry failed: no portal user found for shop', { shopId: effectiveShopId, userId: payload.userId, endpoint: '/api/portal/sales' });
        return jsonResponse({ success: false, error: 'No portal user found for this shop' }, 404);
      }

      portalUser = shopPortalUser as PortalUserType;
    } else {
      const { data: pUser, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('userId', payload.userId)
        .single();

      if (portalError || !pUser) {
        logger.warn('Sales entry failed: portal user not found', { userId: payload.userId, endpoint: '/api/portal/sales' });
        return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
      }

      portalUser = pUser as PortalUserType;
      effectiveShopId = portalUser.shopId;
    }

    // Sanity check for TypeScript (should not happen because we returned above on error)
    if (!portalUser) {
      logger.error('Sales entry failed: portalUser unexpectedly null', { userId: payload.userId, endpoint: '/api/portal/sales' });
      return jsonResponse({ success: false, error: 'Internal server error' }, 500);
    }

    // Determine effective shopId/productId from shopStockId if provided
    let shopId = payloadShopId || effectiveShopId;
    let productId = payloadProductId;

    if (shopStockId) {
      const { data: stockRow, error: stockErr } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('id', shopStockId)
        .single();

      if (stockErr || !stockRow) {
        return jsonResponse({ success: false, error: 'Shop stock not found' }, 404);
      }

      shopId = stockRow.shopId;
      productId = stockRow.productId;
    }

    if (!shopId) {
      logger.error('Sales entry failed: shopId could not be determined', { userId: payload.userId, endpoint: '/api/portal/sales' });
      return jsonResponse({ success: false, error: 'Shop ID could not be determined' }, 500);
    }

    if (portalUser.shopId !== shopId) {
      logger.warn('Sales entry forbidden: user not assigned to shop', { userId: payload.userId, shopId, userShop: portalUser.shopId, endpoint: '/api/portal/sales' });
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Get product
    const { data: product, error: productError } = await supabaseAdmin
      .from('Product')
      .select('*')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return jsonResponse({ success: false, error: 'Product not found' }, 404);
    }

    // If shopStockId provided, re-fetch that row for the update; else fall back to finding shopStock by shopId+productId
    let shopStock: ShopStock | null = null;
    if (shopStockId) {
      const { data: ss, error: ssErr } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('id', shopStockId)
        .single();
      if (ssErr) {
        logger.error('Failed to fetch shopStock by id', { shopStockId, error: ssErr.message });
        return jsonResponse({ success: false, error: 'Failed to fetch shop stock' }, 500);
      }
      shopStock = ss as ShopStock;
    } else {
      const { data: ss, error: ssErr } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('shopId', shopId)
        .eq('productId', productId)
        .single();
      if (ssErr) {
        logger.warn('ShopStock not found for shop/product', { shopId, productId });
        shopStock = null;
      } else {
        shopStock = ss as ShopStock;
      }
    }

    // Server-side stock availability validation to prevent over-selling
    if (shopStock) {
      if (quantity > shopStock.quantity) {
        logger.warn('Attempt to create sale exceeding stock', { shopStockId: shopStock.id, available: shopStock.quantity, requested: quantity });
        return jsonResponse({ success: false, error: `Insufficient stock: only ${shopStock.quantity} available` }, 400);
      }
    }

    const totalAmount = quantity * unitPrice;
    const costPrice = product.price;
    const profit = totalAmount - (costPrice * quantity);
    const marginPercentage = totalAmount > 0 ? (profit / totalAmount) * 100 : 0;

    // Create sales entry
    const saleId = uuidv4();
    const now = new Date().toISOString();

    const { data: saleData, error: saleError } = await supabaseAdmin
      .from('SalesEntry')
      .insert([{
        id: saleId,
        shopId,
        portalUserId: portalUser.id,
        productId,
        quantity,
        unitPrice,
        totalAmount,
        paymentMethod,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        notes: notes || null,
        createdAt: now,
        updatedAt: now,
      }])
      .select()
      .single();

    if (saleError) {
      logger.error('Failed to insert SalesEntry', { error: saleError.message });
      return jsonResponse({ success: false, error: 'Failed to create sale' }, 500);
    }

    // Create profit margin record
    await supabaseAdmin
      .from('ProfitMargin')
      .insert([{
        id: uuidv4(),
        salesEntryId: saleId,
        costPrice: costPrice * quantity,
        sellingPrice: totalAmount,
        profit,
        marginPercentage,
        createdAt: now,
      }]);

    // Update shop stock if exists
    if (shopStock) {
      const newQuantity = Math.max(0, shopStock.quantity - quantity);

      await supabaseAdmin
        .from('ShopStock')
        .update({
          quantity: newQuantity,
          updatedAt: now,
        })
        .eq('id', shopStock.id);

      // Create stock transaction
      await supabaseAdmin
        .from('StockTransaction')
        .insert([{
          id: uuidv4(),
          shopStockId: shopStock.id,
          portalUserId: portalUser.id,
          type: 'subtract',
          quantity: -quantity,
          reason: 'Sale',
          reference: saleId,
          createdAt: now,
        }]);

      // Check for low stock and create alert if necessary
      if (newQuantity <= shopStock.lowStockThreshold && newQuantity > 0) {
        await supabaseAdmin
          .from('LowStockAlert')
          .upsert([{
            shopId,
            productId,
            productName: product.name,
            currentStock: newQuantity,
            threshold: shopStock.lowStockThreshold,
            alertLevel: newQuantity <= 2 ? 'critical' : 'warning',
            isResolved: false,
            updatedAt: now,
          }], {
            onConflict: 'shopId,productId',
          });
      }

      // Sync product stock from shop stocks
      await syncProductStockFromShopStocks(productId);
    }

    logger.info('Sales entry created successfully', {
      shopId,
      productId,
      quantity,
      userId: payload.userId,
      endpoint: '/api/portal/sales',
      duration: Date.now() - startTime
    });

    // Track sales activity
    void trackFromRequest(request, payload, {
      action: 'sale.record', category: 'sale',
      resourceType: 'SalesEntry', resourceId: typeof saleData === 'object' && saleData !== null ? String((saleData as Record<string, unknown>).id || '') : undefined,
      shopId: typeof shopId === 'string' ? shopId : undefined,
      details: { productId, quantity, unitPrice, paymentMethod },
    });

    return jsonResponse({ success: true, data: saleData }, 200);
  } catch (error) {
    logger.error('Sales entry error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/sales',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!shopId) {
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // Get sales entries
    const { data: sales, error } = await supabaseAdmin
      .from('SalesEntry')
      .select('*, ProfitMargin(*)')
      .eq('shopId', shopId)
      .order('createdAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to fetch sales', { error: error.message });
      return jsonResponse({ success: false, error: 'Failed to fetch sales' }, 500);
    }

    return jsonResponse({ success: true, data: sales || [] }, 200);
  } catch (error) {
    logger.error('Sales fetch error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/sales',
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
