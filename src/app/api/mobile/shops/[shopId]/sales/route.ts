import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';
import type { ShopStock } from '@/lib/types';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { validateVariantRemoval, decrementCell } from '@/lib/variant-stock.server';
import { syncProductStockFromShopStocks } from '@/lib/supabase-db';
import { assertCanCreate } from '@/lib/entitlements/enforce.server';
import { generateTaxInvoiceForSale } from '@/lib/etims/tax-invoice.server';
import { syncSaleToQuickBooks } from '@/lib/accounting/sync-sale-to-quickbooks.server';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { idempotentInsert } from '@/lib/sync/idempotent-insert.server';
import { canViewCostData } from '@/lib/cost-visibility.server';
import { hasCapability } from '@/lib/permissions.server';

/**
 * POST /api/mobile/shops/[shopId]/sales
 * Record a new sale
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  const startTime = Date.now();
  
  try {
    const { shopId } = await context.params;
    const auth = await verifyMobileShopAccess(request, shopId);
    if (auth instanceof Response) return auth;

    if (!(await hasCapability(auth.payload, 'record_sales'))) {
      return jsonResponse(
        { success: false, error: 'You do not have permission to record sales. Ask an admin to grant it.', code: 'FORBIDDEN' },
        403,
      );
    }

    const body = await request.json();
    const {
      productId,
      quantity,
      unitPrice,
      shopStockId,
      paymentMethod,
      customerName,
      customerPhone,
      notes,
      size,
      color,
      saleGroupId,
    } = body as {
      productId: string;
      quantity: number;
      unitPrice: number;
      shopStockId?: string;
      paymentMethod?: string;
      customerName?: string;
      customerPhone?: string;
      notes?: string;
      size?: string;
      color?: string;
      /** Shared across every line item recorded in the same checkout — see 20260919_01_sale_group_id.sql. */
      saleGroupId?: string;
    };

    if (!productId || typeof quantity !== 'number' || typeof unitPrice !== 'number') {
      return jsonResponse({
        success: false,
        error: 'Missing required fields: productId, quantity, unitPrice',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    // Offline-first: the app generates the sale id and may retry a request
    // whose response it never received. If that id is already recorded, return
    // it and run none of the side effects (stock, invoice, accounting) again.
    const clientSaleId = isValidClientId((body as { id?: unknown }).id) ? (body as { id: string }).id : null;
    if (clientSaleId) {
      const { data: dup } = await supabaseAdmin
        .from('SalesEntry').select('*').eq('id', clientSaleId).maybeSingle();
      if (dup) {
        return jsonResponse({
          success: true,
          data: {
            saleId: dup.id,
            timestamp: dup.createdAt,
            quantity: dup.quantity,
            unitPrice: dup.unitPrice,
            totalAmount: dup.totalAmount,
            paymentMethod: dup.paymentMethod,
            customerName: dup.customerName,
            customerPhone: dup.customerPhone,
          },
          message: 'Sale already recorded',
          idempotent: true,
        }, 200);
      }
    }

    // Confirm the shop exists in the Shop table and is active
    const { data: shopRow, error: shopRowError } = await supabaseAdmin
      .from('Shop')
      .select('id, name, location, phone, address, isActive, organizationId')
      .eq('id', shopId)
      .single();

    if (shopRowError || !shopRow) {
      logger.warn('Mobile sale failed: shop not found', {
        userId: auth.payload.userId,
        shopId,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({
        success: false,
        error: 'Shop not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    const sRow = shopRow as Record<string, unknown>;
    if (typeof sRow['isActive'] === 'boolean' && !sRow['isActive']) {
      logger.warn('Mobile sale failed: shop inactive', {
        userId: auth.payload.userId,
        shopId,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({
        success: false,
        error: 'Shop is not active',
        code: 'SHOP_INACTIVE'
      }, 403);
    }

    const organizationId = typeof sRow['organizationId'] === 'string' ? (sRow['organizationId'] as string) : null;
    if (organizationId) {
      const limitResponse = await assertCanCreate(organizationId, 'TRANSACTION');
      if (limitResponse) return limitResponse;
    }

    // Get product details
    const { data: product, error: productError } = await supabaseAdmin
      .from('Product')
      .select('*')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      logger.warn('Mobile sale product not found', { 
        userId: auth.payload.userId,
        shopId,
        productId,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Product not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // Get shop stock
    let shopStock: ShopStock | null = null;
    
    if (shopStockId) {
      const { data: ss, error: ssErr } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('id', shopStockId)
        .eq('shopId', shopId)
        .single();

      if (ssErr || !ss) {
        logger.warn('Mobile sale shop stock not found', { 
          userId: auth.payload.userId,
          shopId,
          shopStockId,
          endpoint: `/api/mobile/shops/${shopId}/sales`
        });
        return jsonResponse({ 
          success: false, 
          error: 'Shop stock not found',
          code: 'NOT_FOUND'
        }, 404);
      }
      shopStock = ss;
    } else {
      const { data: ss, error: ssErr } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('shopId', shopId)
        .eq('productId', productId)
        .single();

      if (ssErr || !ss) {
        logger.warn('Mobile sale inventory for product not found', { 
          userId: auth.payload.userId,
          shopId,
          productId,
          endpoint: `/api/mobile/shops/${shopId}/sales`
        });
        return jsonResponse({ 
          success: false, 
          error: 'Product not in stock at this shop',
          code: 'NOT_FOUND'
        }, 404);
      }
      shopStock = ss;
    }

    // Validate stock availability (flat total — still a valid ceiling even with variants)
    if (!shopStock || shopStock.quantity < quantity) {
      const available = shopStock?.quantity || 0;
      logger.warn('Mobile sale insufficient stock', {
        userId: auth.payload.userId,
        shopId,
        productId,
        available,
        requested: quantity,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({
        success: false,
        error: `Insufficient stock: only ${available} available`,
        code: 'INSUFFICIENT_STOCK'
      }, 409);
    }

    // Size × colour matrix: when this product has a breakdown at the shop,
    // the sale is against a specific cell and must name size/colour.
    const variantCheck = await validateVariantRemoval(shopStock.id, size, color, quantity);
    if (variantCheck.needsVariant && variantCheck.error) {
      return jsonResponse({
        success: false,
        error: variantCheck.error,
        code: 'INSUFFICIENT_STOCK',
      }, 409);
    }

    // An admin/owner must fill in cost price before this product can be
    // sold — falling back to product.price (as this used to) silently
    // recorded every sale at 0 profit, hiding that the number was never
    // actually set rather than surfacing it.
    if (product.costPrice == null || Number(product.costPrice) <= 0) {
      logger.warn('Mobile sale blocked: product has no cost price set', {
        userId: auth.payload.userId, shopId, productId,
        endpoint: `/api/mobile/shops/${shopId}/sales`,
      });
      return jsonResponse({
        success: false,
        error: 'This item is missing a cost price. Ask an admin to set it before it can be sold.',
        code: 'COST_PRICE_REQUIRED',
      }, 409);
    }

    // Calculate totals
    const totalAmount = quantity * unitPrice;
    // showCostOnSale only gates what's echoed back to the person who rang
    // this up (see cost-visibility.server.ts) — costPrice itself is always
    // persisted below, a snapshot at sale time, so Analytics/Reports/Sale
    // Detail can compute profit later regardless of who's looking.
    const showCostOnSale = await canViewCostData(auth.payload);
    const costPrice = product.costPrice;
    const profit = totalAmount - (costPrice * quantity);
    const marginPercentage = totalAmount > 0 ? (profit / totalAmount) * 100 : 0;

    // Create sales entry — client id when supplied, else server-generated.
    const saleId = clientSaleId ?? uuidv4();
    const now = new Date().toISOString();

    const insert = await idempotentInsert('SalesEntry', {
      id: saleId,
      organizationId: sRow['organizationId'],
      shopId,
      portalUserId: auth.portalUserId,
      productId,
      quantity,
      unitPrice,
      totalAmount,
      costPrice,
      paymentMethod: paymentMethod || 'cash',
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      notes: notes || null,
      size: variantCheck.needsVariant ? (size?.trim() || null) : null,
      color: variantCheck.needsVariant ? (color?.trim() || null) : null,
      saleGroupId: isValidClientId(saleGroupId) ? saleGroupId : null,
      createdAt: now,
      updatedAt: now,
    });

    if (!insert.ok) {
      logger.error('Mobile sale creation failed', {
        userId: auth.payload.userId, shopId, productId,
        error: insert.error, endpoint: `/api/mobile/shops/${shopId}/sales`,
      });
      return jsonResponse({ success: false, error: 'Failed to record sale', code: 'INTERNAL_ERROR' }, 500);
    }

    // The row already existed (a race between two retries slipped past the
    // check above) — return it, touch nothing else.
    if (!insert.created) {
      const dup = insert.row as Record<string, unknown>;
      return jsonResponse({
        success: true,
        data: { saleId: dup.id, timestamp: dup.createdAt, quantity: dup.quantity, totalAmount: dup.totalAmount },
        message: 'Sale already recorded',
        idempotent: true,
      }, 200);
    }

    // Update stock. With a size × colour breakdown, decrement the specific
    // cell — the DB trigger rolls that down to ShopStock.quantity (and
    // syncProductStockFromShopStocks to Product.stockQuantity). Otherwise
    // decrement the flat ShopStock.quantity as before.
    if (variantCheck.needsVariant) {
      const dec = await decrementCell(shopStock.id, size || '', color || '', quantity);
      if (!dec.ok) {
        logger.error('Mobile sale variant decrement failed', {
          shopId, productId, size, color, error: dec.error,
          endpoint: `/api/mobile/shops/${shopId}/sales`,
        });
      }
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('ShopStock')
        .update({ quantity: shopStock.quantity - quantity, updatedAt: now })
        .eq('id', shopStock.id);
      if (updateError) {
        logger.error('Mobile sale stock update failed', {
          userId: auth.payload.userId, shopId, shopStockId: shopStock?.id,
          error: updateError.message, endpoint: `/api/mobile/shops/${shopId}/sales`,
        });
      }
    }

    // Roll the shop-level total up to Product.stockQuantity.
    void syncProductStockFromShopStocks(productId);

    const duration = Date.now() - startTime;
    logger.info('Mobile sale recorded successfully', { 
      userId: auth.payload.userId,
      shopId,
      saleId,
      productId,
      quantity,
      totalAmount,
      duration,
      endpoint: `/api/mobile/shops/${shopId}/sales`
    });

    // Fire-and-forget integrations — a sale must never fail because one of these had a problem.
    void generateTaxInvoiceForSale(saleId);
    void syncSaleToQuickBooks(saleId);

    return jsonResponse({
      success: true,
      data: {
        saleId,
        saleNumber: `SALE-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${saleId.substring(0, 6).toUpperCase()}`,
        timestamp: now,
        product: {
          name: product.name,
          sku: product.sku
        },
        quantity,
        unitPrice,
        totalAmount,
        costPrice: showCostOnSale ? costPrice : null,
        profit: showCostOnSale ? profit : null,
        marginPercentage: showCostOnSale ? Math.round(marginPercentage * 100) / 100 : null,
        paymentMethod: paymentMethod || 'cash',
        customerName: customerName || null,
        customerPhone: customerPhone || null
      },
      message: 'Sale recorded successfully'
    }, 201);

  } catch (error) {
    logger.error('Mobile sale recording error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/sales'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

