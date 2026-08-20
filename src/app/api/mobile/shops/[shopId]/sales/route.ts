import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';
import type { ShopStock } from '@/lib/types';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { assertCanCreate } from '@/lib/entitlements/enforce.server';
import { generateTaxInvoiceForSale } from '@/lib/etims/tax-invoice.server';
import { syncSaleToQuickBooks } from '@/lib/accounting/sync-sale-to-quickbooks.server';

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
    } = body as {
      productId: string;
      quantity: number;
      unitPrice: number;
      shopStockId?: string;
      paymentMethod?: string;
      customerName?: string;
      customerPhone?: string;
      notes?: string;
    };

    if (!productId || typeof quantity !== 'number' || typeof unitPrice !== 'number') {
      return jsonResponse({
        success: false,
        error: 'Missing required fields: productId, quantity, unitPrice',
        code: 'VALIDATION_ERROR',
      }, 400);
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

    // Validate stock availability
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

    // Calculate totals
    const totalAmount = quantity * unitPrice;
    const costPrice = product.costPrice || product.price;
    const profit = totalAmount - (costPrice * quantity);
    const marginPercentage = totalAmount > 0 ? (profit / totalAmount) * 100 : 0;

    // Create sales entry
    const saleId = uuidv4();
    const now = new Date().toISOString();

    const { data: saleData, error: saleError } = await supabaseAdmin
      .from('SalesEntry')
      .insert([{
        id: saleId,
        organizationId: sRow['organizationId'],
        shopId,
        portalUserId: auth.portalUserId,
        productId,
        quantity,
        unitPrice,
        totalAmount,
        paymentMethod: paymentMethod || 'cash',
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        notes: notes || null,
        createdAt: now,
        updatedAt: now
      }])
      .select('*')
      .single();

    if (saleError || !saleData) {
      logger.error('Mobile sale creation failed', { 
        userId: auth.payload.userId,
        shopId,
        productId,
        error: saleError?.message,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to record sale',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    // Update shop stock
    const { error: updateError } = await supabaseAdmin
      .from('ShopStock')
      .update({ 
        quantity: shopStock.quantity - quantity,
        updatedAt: now
      })
      .eq('id', shopStock.id);

    if (updateError) {
      logger.error('Mobile sale stock update failed', { 
        userId: auth.payload.userId,
        shopId,
        shopStockId: shopStock?.id,
        error: updateError.message,
        endpoint: `/api/mobile/shops/${shopId}/sales`
      });
      // Don't fail the response, just log it
      // The sale is already recorded
    }

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
        costPrice,
        profit,
        marginPercentage: Math.round(marginPercentage * 100) / 100,
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

