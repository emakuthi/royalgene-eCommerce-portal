/**
 * POST /api/portal/stock/transfer
 * Transfer stock units of a product from one shop to another.
 *
 * Request body:
 *   fromShopStockId – ShopStock.id of the source row
 *   toShopId        – destination Shop.id
 *   quantity        – number of units to transfer (must be > 0 and <= source quantity)
 *   notes?          – optional reason / notes for the transfer
 *
 * Behaviour:
 *   • Decrements source ShopStock.quantity by [quantity]
 *   • If destination already has a ShopStock row for the same product → increments it
 *   • Otherwise creates a new ShopStock row in the destination shop
 *   • Records a StockTransaction for both the source and destination
 *   • Syncs the aggregated Product.stockQuantity on both products (they are the same product)
 *
 * Auth:
 *   • admin / super_admin → can transfer between any shops
 *   • portal_user          → can only transfer FROM their own shop
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { trackFromRequest } from '@/lib/activity-tracker';
import type { ShopStock } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await request.json() as {
      fromShopStockId?: string;
      toShopId?: string;
      quantity?: number;
      notes?: string;
    };

    const { fromShopStockId, toShopId, quantity, notes } = body;

    if (!fromShopStockId || !toShopId || quantity == null) {
      return jsonResponse(
        { success: false, error: 'fromShopStockId, toShopId, and quantity are required' },
        400,
      );
    }

    const transferQty = Number(quantity);
    if (!Number.isFinite(transferQty) || transferQty <= 0) {
      return jsonResponse(
        { success: false, error: 'quantity must be a positive number' },
        400,
      );
    }

    // ── Load source ShopStock ────────────────────────────────────────────────
    const { data: srcStock, error: srcErr } = await supabaseAdmin
      .from('ShopStock')
      .select('*')
      .eq('id', fromShopStockId)
      .maybeSingle();

    if (srcErr || !srcStock) {
      logger.warn('Stock transfer: source ShopStock not found', { fromShopStockId, userId: payload.userId });
      return jsonResponse({ success: false, error: 'Source stock not found' }, 404);
    }

    const src = srcStock as ShopStock & { productId: string; shopId: string; organizationId: string };

    // ── Guard: even an "admin" role is org-scoped — the source stock must
    // belong to the caller's own organization (true super_admin exempt) ────
    if (payload.organizationId && src.organizationId !== payload.organizationId) {
      logger.warn('Stock transfer forbidden: source stock not in caller organization', { userId: payload.userId, fromShopStockId });
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // ── Guard: portal users can only transfer from their own shop ───────────
    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      const { data: portalUser } = await supabaseAdmin
        .from('PortalUser')
        .select('shopId')
        .eq('userId', payload.userId)
        .maybeSingle();

      if (!portalUser || portalUser.shopId !== src.shopId) {
        logger.warn('Stock transfer forbidden: user not assigned to source shop', {
          userId: payload.userId,
          sourceShopId: src.shopId,
          userShopId: portalUser?.shopId,
        });
        return jsonResponse({ success: false, error: 'Forbidden: you can only transfer from your own shop' }, 403);
      }
    }

    // ── Guard: cannot transfer to the same shop ─────────────────────────────
    if (src.shopId === toShopId) {
      return jsonResponse({ success: false, error: 'Source and destination shops must be different' }, 400);
    }

    // ── Guard: sufficient stock in source ───────────────────────────────────
    if (src.quantity < transferQty) {
      return jsonResponse(
        { success: false, error: `Insufficient stock. Available: ${src.quantity}, requested: ${transferQty}` },
        400,
      );
    }

    // ── Verify destination shop exists AND belongs to the SAME organization
    // as the source — without this, stock could be transferred straight
    // into a completely different tenant's shop. ────────────────────────────
    const { data: destShop, error: destShopErr } = await supabaseAdmin
      .from('Shop')
      .select('id, name, organizationId')
      .eq('id', toShopId)
      .maybeSingle();

    if (destShopErr || !destShop) {
      return jsonResponse({ success: false, error: 'Destination shop not found' }, 404);
    }
    if (destShop.organizationId !== src.organizationId) {
      logger.warn('Stock transfer forbidden: destination shop in a different organization', {
        userId: payload.userId, sourceOrg: src.organizationId, destOrg: destShop.organizationId, toShopId,
      });
      return jsonResponse({ success: false, error: 'Destination shop must belong to the same organization' }, 403);
    }

    // ── Check if destination already has stock for this product ─────────────
    const { data: destStock } = await supabaseAdmin
      .from('ShopStock')
      .select('id, quantity')
      .eq('shopId', toShopId)
      .eq('productId', src.productId)
      .maybeSingle();

    const now = new Date().toISOString();
    const portalUserId = `${payload.role === 'admin' || payload.role === 'super_admin' ? 'admin' : 'user'}-${payload.userId}`;

    // ── Decrement source ─────────────────────────────────────────────────────
    const newSrcQty = src.quantity - transferQty;
    const { data: updatedSrc, error: srcUpdateErr } = await supabaseAdmin
      .from('ShopStock')
      .update({ quantity: newSrcQty, updatedAt: now })
      .eq('id', fromShopStockId)
      .select()
      .single();

    if (srcUpdateErr || !updatedSrc) {
      logger.error('Stock transfer: failed to decrement source', { error: srcUpdateErr?.message, fromShopStockId });
      return jsonResponse({ success: false, error: 'Failed to update source stock' }, 500);
    }

    // ── Increment or create destination ─────────────────────────────────────
    let destStockId: string;

    if (destStock) {
      const newDestQty = (destStock.quantity as number) + transferQty;
      await supabaseAdmin
        .from('ShopStock')
        .update({ quantity: newDestQty, updatedAt: now })
        .eq('id', destStock.id);
      destStockId = destStock.id as string;
    } else {
      // Create a fresh ShopStock row in the destination shop
      const newStockId = uuidv4();
      await supabaseAdmin.from('ShopStock').insert([{
        id: newStockId,
        organizationId: src.organizationId,
        shopId: toShopId,
        productId: src.productId,
        quantity: transferQty,
        lowStockThreshold: src.lowStockThreshold ?? 5,
        createdAt: now,
        updatedAt: now,
      }]);
      destStockId = newStockId;
    }

    // ── StockTransaction – source (subtract) ────────────────────────────────
    await supabaseAdmin.from('StockTransaction').insert([{
      id: uuidv4(),
      organizationId: src.organizationId,
      shopStockId: fromShopStockId,
      portalUserId,
      type: 'subtract',
      quantity: -transferQty,
      reason: `Transfer out to shop ${destShop.name}${notes ? ` — ${notes}` : ''}`,
      reference: `transfer-${now}`,
      createdAt: now,
    }]);

    // ── StockTransaction – destination (add) ────────────────────────────────
    await supabaseAdmin.from('StockTransaction').insert([{
      id: uuidv4(),
      organizationId: src.organizationId,
      shopStockId: destStockId,
      portalUserId,
      type: 'add',
      quantity: transferQty,
      reason: `Transfer in from shop ${src.shopId}${notes ? ` — ${notes}` : ''}`,
      reference: `transfer-${now}`,
      createdAt: now,
    }]);

    // ── Sync aggregated product stockQuantity ────────────────────────────────
    try {
      await syncProductStockFromShopStocks(src.productId);
    } catch (syncErr) {
      logger.warn('Stock transfer: failed to sync product stockQuantity', {
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
        productId: src.productId,
      });
    }

    // ── Activity tracking ────────────────────────────────────────────────────
    void trackFromRequest(request, payload, {
      action: 'stock.transfer',
      category: 'stock',
      resourceType: 'ShopStock',
      resourceId: fromShopStockId,
      shopId: src.shopId,
      details: {
        fromShopId: src.shopId,
        toShopId,
        toShopName: destShop.name,
        productId: src.productId,
        quantity: transferQty,
        notes,
      },
    });

    logger.info('Stock transfer completed', {
      userId: payload.userId,
      fromShopStockId,
      toShopId,
      productId: src.productId,
      quantity: transferQty,
    });

    return jsonResponse({
      success: true,
      message: `${transferQty} unit(s) transferred successfully to ${destShop.name}`,
      data: {
        fromShopStockId,
        toShopId,
        toShopName: destShop.name,
        productId: src.productId,
        quantity: transferQty,
        newSourceQuantity: newSrcQty,
      },
    }, 200);

  } catch (error) {
    logger.error('Stock transfer error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/stock/transfer',
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}

