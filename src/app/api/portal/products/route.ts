// Explanation: New portal API route to create a Product and initial ShopStock for the current user's shop.
// It verifies the token, resolves the portal user's shop (or accepts an admin-provided shopId), creates the product
// using the existing createProduct helper (with Supabase/fallback behavior), then creates a ShopStock row and returns it.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { createProductForShop } from '@/lib/portal-products';
import type { ShopStock, Product } from '@/lib/types';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';

type IncomingStock = { quantity?: number; lowStockThreshold?: number };

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (!payload.organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required to create a product' }, 400);
    }
    const organizationId = payload.organizationId;

    const body = await request.json() as { product?: Record<string, unknown>; stock?: IncomingStock; shopId?: string };
    const { product: productData, stock: stockData, shopId: providedShopId } = body || {};

    if (!productData || !productData.name || !productData.sku) {
      return jsonResponse({ success: false, error: 'Missing product name or sku' }, 400);
    }

    // Resolve shopId: portal users must create under their shop; admins may provide an admin-provided shopId
    let shopId: string | null = null;
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .limit(1)
      .maybeSingle();

    if (portalUser && !portalError) {
      const portalData = portalUser as unknown as Record<string, unknown>;
      // If a shopId was explicitly provided (e.g. user picked from multi-shop list), prefer it
      shopId = providedShopId || (typeof portalData.shopId === 'string' ? portalData.shopId : null);
    } else if (payload.role === 'admin' || payload.role === 'super_admin') {
      // admins can provide shopId in the request body
      shopId = providedShopId || null;
    }

    if (!shopId) {
      logger.warn('Create product failed: shopId unresolved', { userId: payload.userId, endpoint: '/api/portal/products' });
      return jsonResponse({ success: false, error: 'Shop ID required' }, 400);
    }

    // The shop must actually belong to the caller's own organization — an org
    // "admin" providing an arbitrary shopId in the body could otherwise target
    // another tenant's shop entirely.
    const { data: shopCheck } = await supabaseAdmin
      .from('Shop')
      .select('id')
      .eq('id', shopId)
      .eq('organizationId', organizationId)
      .maybeSingle();
    if (!shopCheck) {
      logger.warn('Create product forbidden: shop not in caller organization', { userId: payload.userId, shopId, endpoint: '/api/portal/products' });
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // --------- New validations ---------
    const sku = String(productData.sku);

    // SKU uniqueness check, scoped to the organization's own catalog
    try {
      const { data: existing, error: skuErr } = await supabaseAdmin
        .from('Product')
        .select('*')
        .eq('sku', sku)
        .eq('organizationId', organizationId)
        .maybeSingle();

      if (skuErr) {
        logger.warn('SKU check error', { error: skuErr });
      }

      if (existing) {
        return jsonResponse({ success: false, error: 'Product SKU already exists' }, 409);
      }
    } catch (e) {
      logger.warn('SKU lookup failed', { error: e instanceof Error ? e.message : String(e) });
    }

    // Category validation
    const allowedCategories = ['dresses', 'shoes', 'trousers', 'textiles'];
    if (productData.category && typeof productData.category === 'string' && !allowedCategories.includes(productData.category)) {
      return jsonResponse({ success: false, error: 'Invalid category' }, 400);
    }

    // Price validation (if provided)
    if (productData.price !== undefined) {
      const priceNum = Number(productData.price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return jsonResponse({ success: false, error: 'Invalid price' }, 400);
      }
    }

    // Stock quantity validations (product-level and stock-level)
    if (productData.stockQuantity !== undefined) {
      const prodQty = Number(productData.stockQuantity);
      if (!Number.isFinite(prodQty) || prodQty < 0) {
        return jsonResponse({ success: false, error: 'Invalid stock quantity' }, 400);
      }
    }
    if (stockData?.quantity !== undefined) {
      const stockQty = Number(stockData.quantity);
      if (!Number.isFinite(stockQty) || stockQty < 0) {
        return jsonResponse({ success: false, error: 'Invalid stock quantity' }, 400);
      }
    }
    // -----------------------------------

    logger.info('Creating product for shop', { shopId, userId: payload.userId, endpoint: '/api/portal/products' });

    // Delegate creation to helper that can be reused in tests/scripts
    const created = await createProductForShop(productData as Record<string, unknown>, stockData || {}, shopId, payload.userId, organizationId);

    // If the helper used the in-memory fallback, surface a warning so the UI can inform the user
    const createdObj = created as unknown as Record<string, unknown> | undefined;
    const responseBody: Record<string, unknown> = { success: true, data: created };
    if (createdObj && createdObj.inMemoryFallback) {
      responseBody.warning = 'Created in fallback in-memory DB; Supabase insertion failed. Check server logs.';
      logger.warn('Product/ShopStock created in in-memory fallback (Supabase insertion failed)', { shopId, productSku: productData.sku, userId: payload.userId });

      // (debug) internal supabase error info is no longer returned to clients
    }

    // Track product creation activity
    const createdId = createdObj?.id ? String(createdObj.id) : undefined;
    void trackFromRequest(request, payload, {
      action: 'product.create', category: 'product',
      resourceType: 'Product', resourceId: createdId,
      shopId,
      details: { sku: productData.sku, name: productData.name, fallback: !!createdObj?.inMemoryFallback },
    });

    return jsonResponse(responseBody, 201);
  } catch (error) {
    logger.error('Create product route failure', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

// Handle CORS preflight so browsers can send DELETE/PUT with Authorization/Content-Type
export async function OPTIONS(request: NextRequest) {
  return optionsResponse('GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

// New: allow portal users (shop owners) to delete the product from their shop (remove ShopStock row).
export async function DELETE(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const body = await request.json() as { id?: string; productId?: string; shopId?: string };
    const productId = String(body.id || body.productId || '');
    const providedShopId = typeof body.shopId === 'string' ? body.shopId : undefined;

    if (!productId) {
      return jsonResponse({ success: false, error: 'Product ID required' }, 400);
    }

    // Org-scope check for the admin path — an "admin" role is still tenant-scoped.
    // Verify whichever resource is about to be touched (a specific shop's stock
    // row, or the product itself for a full delete) actually belongs to the
    // caller's own organization before anything is deleted.
    if (payload.organizationId && (payload.role === 'admin' || payload.role === 'super_admin')) {
      if (providedShopId) {
        const { data: shopCheck } = await supabaseAdmin
          .from('Shop')
          .select('id')
          .eq('id', providedShopId)
          .eq('organizationId', payload.organizationId)
          .maybeSingle();
        if (!shopCheck) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      } else {
        const { data: productCheck } = await supabaseAdmin
          .from('Product')
          .select('id')
          .eq('id', productId)
          .eq('organizationId', payload.organizationId)
          .maybeSingle();
        if (!productCheck) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
    }

    // Track product deletion (fire-and-forget)
    void trackFromRequest(request, payload, {
      action: 'product.delete', category: 'product',
      resourceType: 'Product', resourceId: productId,
      shopId: providedShopId,
      details: { adminDelete: payload.role === 'admin' || payload.role === 'super_admin' },
    });

    // If admin/super_admin and provided shopId, allow deleting only that ShopStock row
    if (payload.role === 'admin' || payload.role === 'super_admin') {
      try {
        if (providedShopId) {
          const { error } = await supabaseAdmin.from('ShopStock').delete().eq('productId', productId).eq('shopId', providedShopId);
          if (error) {
            logger.warn('Supabase ShopStock delete failed for admin; attempting in-memory fallback', { error: String(error), productId, shopId: providedShopId });
            try {
              const { db } = await import('@/lib/db');
              const filtered = (db.shopStocks as unknown as ShopStock[]).filter((s) => !(s.productId === productId && s.shopId === providedShopId));
              db.shopStocks = filtered as unknown as ShopStock[];
              return jsonResponse({ success: true }, 200);
            } catch (fallbackErr) {
              logger.error('Admin delete in-memory fallback failed', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
              return jsonResponse({ success: false, error: 'Failed to delete' }, 500);
            }
          }
          return jsonResponse({ success: true }, 200);
        }

        // If no shopId provided, admins may request full product deletion (remove product + shopstock)
        // Use existing db helper to keep behavior consistent
        try {
          await (await import('@/lib/supabase-db')).deleteProduct(productId);
          return jsonResponse({ success: true }, 200);
        } catch (supabaseErr) {
          logger.warn('Admin full-product delete failed in Supabase; attempting in-memory fallback', { error: supabaseErr instanceof Error ? supabaseErr.message : String(supabaseErr), productId });
          try {
            const { db } = await import('@/lib/db');
            db.products = db.products.filter((p: Product) => p.id !== productId);
            const remaining = (db.shopStocks as unknown as ShopStock[]).filter((s) => s.productId !== productId);
            db.shopStocks = remaining as unknown as ShopStock[];
            return jsonResponse({ success: true }, 200);
          } catch (fallbackErr) {
            logger.error('Admin full-product delete fallback failed', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
            return jsonResponse({ success: false, error: 'Failed to delete' }, 500);
          }
        }
      } catch (err) {
        logger.warn('Admin portal delete failed, attempting in-memory fallback', { error: err instanceof Error ? err.message : String(err), productId, shopId: providedShopId });
        try {
          const { db } = await import('@/lib/db');
          if (providedShopId) {
            const filtered = (db.shopStocks as unknown as ShopStock[]).filter((s) => !(s.productId === productId && s.shopId === providedShopId));
            db.shopStocks = filtered as unknown as ShopStock[];
             return jsonResponse({ success: true }, 200);
           }
          db.products = db.products.filter((p: Product) => p.id !== productId);
          const remaining = (db.shopStocks as unknown as ShopStock[]).filter((s) => s.productId !== productId);
          db.shopStocks = remaining as unknown as ShopStock[];
           return jsonResponse({ success: true }, 200);
         } catch (fallbackErr) {
           logger.error('Admin delete fallback failed', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
           return jsonResponse({ success: false, error: 'Failed to delete' }, 500);
         }
       }
    }

    // For portal users: delete the ShopStock row for their shop only
    try {
      const { data: portalUser, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('userId', payload.userId)
        .limit(1)
        .maybeSingle();

      if (portalError || !portalUser) {
        logger.warn('Delete product failed: portal user not found', { userId: payload.userId });
        return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
      }

      const shopId = (portalUser as Record<string, unknown>).shopId as string | undefined;
      if (!shopId) {
        logger.warn('Delete product failed: portal user has no shopId', { userId: payload.userId });
        return jsonResponse({ success: false, error: 'Shop ID unavailable' }, 400);
      }

      const { error } = await supabaseAdmin.from('ShopStock').delete().eq('productId', productId).eq('shopId', shopId);
      if (error) {
        logger.warn('Supabase ShopStock delete failed for portal user; attempting in-memory fallback', { error: String(error), productId, shopId });
        try {
          const { db } = await import('@/lib/db');
          const filtered = (db.shopStocks as unknown as ShopStock[]).filter((s) => !(s.productId === productId && s.shopId === shopId));
          db.shopStocks = filtered as unknown as ShopStock[];
          return jsonResponse({ success: true }, 200);
        } catch (fallbackErr) {
          logger.error('Portal delete in-memory fallback failed', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
          return jsonResponse({ success: false, error: 'Failed to delete' }, 500);
        }
      }

      return jsonResponse({ success: true }, 200);
    } catch (err) {
      logger.warn('Portal delete failed, falling back to in-memory DB', { error: err instanceof Error ? err.message : String(err), productId });
      try {
        const { db } = await import('@/lib/db');
        const { data: portalUser } = await supabaseAdmin.from('PortalUser').select('*').eq('userId', payload.userId).limit(1).maybeSingle();
        const shopId = (portalUser as Record<string, unknown>)?.shopId as string | undefined;
        if (!shopId) return jsonResponse({ success: false, error: 'Shop ID unavailable' }, 400);

        const filtered = (db.shopStocks as unknown as ShopStock[]).filter((s) => !(s.productId === productId && s.shopId === shopId));
        db.shopStocks = filtered as unknown as ShopStock[];
         return jsonResponse({ success: true }, 200);
       } catch (fallbackErr) {
         logger.error('Portal delete fallback failed', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
         return jsonResponse({ success: false, error: 'Failed to delete' }, 500);
       }
     }
   } catch (error) {
     logger.error('Delete product route failure', { error: error instanceof Error ? error.message : String(error) });
     return jsonResponse({ success: false, error: 'Internal server error' }, 500);
   }
 }

// New: allow portal users (shop owners) to update existing products in their shop.
// Admins can update any product. Returns the updated product.
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const body = await request.json() as Record<string, unknown>;
    const productId = typeof body.id === 'string' ? body.id : (typeof body.productId === 'string' ? body.productId : undefined);
    if (!productId) {
      return jsonResponse({ success: false, error: 'Product ID required' }, 400);
    }

    // For portal users ensure the product belongs to their shop (via ShopStock)
    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      const { data: portalUser, error: portalErr } = await supabaseAdmin
        .from('PortalUser')
        .select('*')
        .eq('userId', payload.userId)
        .limit(1)
        .maybeSingle();

      if (portalErr || !portalUser) {
        logger.warn('Update product failed: portal user not found', { userId: payload.userId, endpoint: '/api/portal/products' });
        return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
      }

      // ensure ShopStock exists for this product in the user's shop
      const shopId = (portalUser as Record<string, unknown>).shopId as string | undefined;
      if (!shopId) {
        logger.warn('Update product failed: portal user has no shop assigned', { userId: payload.userId, endpoint: '/api/portal/products' });
        return jsonResponse({ success: false, error: 'Portal user has no shop' }, 403);
      }

      const { data: ss, error: ssErr } = await supabaseAdmin
        .from('ShopStock')
        .select('id')
        .eq('shopId', shopId)
        .eq('productId', productId)
        .maybeSingle();

      if (ssErr || !ss) {
        logger.warn('Update product forbidden: product not in user shop', { userId: payload.userId, shopId, productId, endpoint: '/api/portal/products' });
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
    } else if (payload.organizationId) {
      // Org "admin" (not platform super_admin) — still verify the product is
      // actually theirs before letting them update it by ID.
      const { data: productCheck } = await supabaseAdmin
        .from('Product')
        .select('id')
        .eq('id', productId)
        .eq('organizationId', payload.organizationId)
        .maybeSingle();
      if (!productCheck) {
        logger.warn('Update product forbidden: product not in caller organization', { userId: payload.userId, productId, endpoint: '/api/portal/products' });
        return jsonResponse({ success: false, error: 'Forbidden' }, 403);
      }
    }

    // Build update object from allowed fields
    const allowedFields = ['name', 'description', 'price', 'costPrice', 'sizes', 'colors', 'images', 'sku', 'featured', 'trending'];
    const updates: Record<string, unknown> = {};
    for (const k of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, k)) updates[k] = (body as Record<string, unknown>)[k] as unknown;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, error: 'No updatable fields provided' }, 400);
    }

    updates.updatedAt = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('Product')
      .update(updates)
      .eq('id', productId)
      .select()
      .maybeSingle();

    if (updateError) {
      logger.error('Failed to update product', { productId, error: updateError.message });
      return jsonResponse({ success: false, error: 'Failed to update product' }, 500);
    }

    // Track product update
    void trackFromRequest(request, payload, {
      action: 'product.update', category: 'product',
      resourceType: 'Product', resourceId: productId,
      details: { updatedFields: Object.keys(updates).filter(k => k !== 'updatedAt') },
    });

    return jsonResponse({ success: true, data: updated }, 200);
  } catch (err) {
    logger.error('Update product route failure', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}
