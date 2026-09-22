/**
 * GET /api/portal/analytics/inventory
 *
 * Org-wide stock on hand and its value, per shop — the portal counterpart to
 * the Android Analytics screen's Inventory card (InventoryValuator.kt).
 * Admins only. Deliberately NOT scoped by the page's shop/date filters:
 * "how much stock do we hold, and where" is a point-in-time question, not a
 * range one, so this always covers every active shop in the org regardless
 * of which single shop (or "All Shops") is currently selected elsewhere on
 * the page.
 *
 * Valuation rules (identical to the Android version, kept in step
 * deliberately — the two should never disagree about the same numbers):
 *  - A stock row with size/colour cells is valued cell by cell (a cell can
 *    carry its own price/cost); everything else is `quantity × the
 *    product's price/cost`.
 *  - A cell with no price of its own falls back to the product's price,
 *    matching how a sale prices it.
 *  - Stock of a deleted/unknown product is skipped.
 *  - Cost value is reported only when EVERY unit in scope has a known cost.
 *    A partial sum would look like a real number while silently
 *    undercounting, so it's withheld (null) instead of guessed at.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { canViewCostData } from '@/lib/cost-visibility.server';

interface ShopRow { id: string; name: string }
interface ShopStockRow { id: string; shopId: string; productId: string; quantity: number }
interface VariantRow { shopStockId: string; quantity: number; price?: number | null; costPrice?: number | null }
interface ProductRow { id: string; price: number; costPrice?: number | null }

export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    const isAdmin = payload.role === 'admin' || payload.role === 'super_admin';
    if (!isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    const showCost = await canViewCostData(payload);

    const { data: shops, error: shopsError } = await supabaseAdmin
      .from('Shop')
      .select('id, name')
      .eq('organizationId', payload.organizationId as string)
      .eq('isActive', true);
    if (shopsError) {
      logger.error('Portal inventory analytics: failed to fetch shops', { error: shopsError.message });
      return jsonResponse({ success: false, error: 'Failed to fetch inventory value' }, 500);
    }
    const shopRows = (shops ?? []) as ShopRow[];
    if (shopRows.length === 0) {
      return jsonResponse({ success: true, data: { totalUnits: 0, totalRetailValue: 0, totalCostValue: showCost ? 0 : null, shops: [] } }, 200);
    }
    const shopIds = shopRows.map(s => s.id);

    const { data: stocks, error: stocksError } = await supabaseAdmin
      .from('ShopStock')
      .select('id, shopId, productId, quantity')
      .in('shopId', shopIds);
    if (stocksError) {
      logger.error('Portal inventory analytics: failed to fetch stock', { error: stocksError.message });
      return jsonResponse({ success: false, error: 'Failed to fetch inventory value' }, 500);
    }
    const stockRows = (stocks ?? []) as ShopStockRow[];

    const stockIds = stockRows.map(s => s.id);
    let variantRows: VariantRow[] = [];
    if (stockIds.length > 0) {
      const { data: variants, error: variantsError } = await supabaseAdmin
        .from('ShopStockVariant')
        .select('shopStockId, quantity, price, costPrice')
        .in('shopStockId', stockIds);
      if (variantsError) {
        logger.error('Portal inventory analytics: failed to fetch variants', { error: variantsError.message });
        return jsonResponse({ success: false, error: 'Failed to fetch inventory value' }, 500);
      }
      variantRows = (variants ?? []) as VariantRow[];
    }

    const productIds = Array.from(new Set(stockRows.map(s => s.productId).filter(Boolean)));
    let productRows: ProductRow[] = [];
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from('Product')
        .select('id, price, costPrice')
        .in('id', productIds);
      if (productsError) {
        logger.error('Portal inventory analytics: failed to fetch products', { error: productsError.message });
        return jsonResponse({ success: false, error: 'Failed to fetch inventory value' }, 500);
      }
      productRows = (products ?? []) as ProductRow[];
    }

    const productById = new Map(productRows.map(p => [p.id, p]));
    const cellsByStockId = new Map<string, VariantRow[]>();
    for (const v of variantRows) {
      const list = cellsByStockId.get(v.shopStockId);
      if (list) list.push(v); else cellsByStockId.set(v.shopStockId, [v]);
    }

    interface Acc { units: number; retail: number; cost: number; unknownCostUnits: number }
    const perShop = new Map<string, Acc>(shopRows.map(s => [s.id, { units: 0, retail: 0, cost: 0, unknownCostUnits: 0 }]));

    for (const stock of stockRows) {
      const acc = perShop.get(stock.shopId);
      const product = productById.get(stock.productId);
      if (!acc || !product) continue; // deleted/unknown shop or product
      const productPrice = Number(product.price) || 0;
      const productCost = product.costPrice == null ? null : Number(product.costPrice);

      const cells = cellsByStockId.get(stock.id);
      if (cells && cells.length > 0) {
        for (const cell of cells) {
          const price = cell.price != null ? Number(cell.price) : productPrice;
          const cost = cell.costPrice != null ? Number(cell.costPrice) : productCost;
          acc.units += cell.quantity;
          acc.retail += cell.quantity * price;
          if (cost != null) acc.cost += cell.quantity * cost; else acc.unknownCostUnits += cell.quantity;
        }
      } else {
        acc.units += stock.quantity;
        acc.retail += stock.quantity * productPrice;
        if (productCost != null) acc.cost += stock.quantity * productCost; else acc.unknownCostUnits += stock.quantity;
      }
    }

    const shopsOut = shopRows
      .map(shop => {
        const acc = perShop.get(shop.id)!;
        return {
          shopId: shop.id,
          shopName: shop.name,
          units: acc.units,
          retailValue: acc.retail,
          costValue: showCost && acc.unknownCostUnits === 0 ? acc.cost : null,
        };
      })
      .sort((a, b) => b.retailValue - a.retailValue);

    const totalUnits = shopsOut.reduce((sum, s) => sum + s.units, 0);
    const totalRetailValue = shopsOut.reduce((sum, s) => sum + s.retailValue, 0);
    const allCostsKnown = Array.from(perShop.values()).every(a => a.unknownCostUnits === 0);
    const totalCostValue = showCost && allCostsKnown ? shopsOut.reduce((sum, s) => sum + (s.costValue ?? 0), 0) : null;

    return jsonResponse({
      success: true,
      data: { totalUnits, totalRetailValue, totalCostValue, shops: shopsOut },
    }, 200);
  } catch (error) {
    logger.error('Portal inventory analytics error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}
