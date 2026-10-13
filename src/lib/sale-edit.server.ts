import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import { syncProductStockFromShopStocks } from './supabase-db';
import { decrementCell, hasVariantStock, incrementCell } from './variant-stock.server';
import { isOwnerLevelCaller } from './permissions.server';
import { parseSaleDiscount } from './sale-discount';
import type { VerifiedPayload } from './auth.server';
import logger from './logger';
import { quantityError } from './business-types';
import { productUnit } from './business-settings.server';

/**
 * Editing a recorded sale — shared by the portal (PATCH /api/portal/sales/[id])
 * and the app (PATCH /api/mobile/shops/[shopId]/sales/[saleId]), which used
 * to carry two diverging copies (the app's never adjusted stock at all).
 *
 * Who: staff may edit only the sales they recorded; owner-level callers
 * (admin, shop_owner) may edit any sale in their organization. Callers still
 * do their own org/shop scoping first — this only decides ownership.
 */

/** The caller's PortalUser ids — one per shop they're assigned to. */
async function callerPortalUserIds(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', userId);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

export async function canEditSale(payload: VerifiedPayload, sale: { portalUserId?: string | null }): Promise<boolean> {
  if (await isOwnerLevelCaller(payload)) return true;
  if (!payload.userId || !sale.portalUserId) return false;
  return (await callerPortalUserIds(payload.userId)).has(sale.portalUserId);
}

/** Which of [sales] the caller may edit — one lookup for a whole list. */
export async function editableSaleIds(
  payload: VerifiedPayload,
  sales: { id: string; portalUserId?: string | null }[],
): Promise<Set<string>> {
  if (await isOwnerLevelCaller(payload)) return new Set(sales.map((s) => s.id));
  if (!payload.userId) return new Set();
  const mine = await callerPortalUserIds(payload.userId);
  return new Set(sales.filter((s) => s.portalUserId && mine.has(s.portalUserId)).map((s) => s.id));
}

export const NOT_YOUR_SALE = 'You can only edit sales you recorded. Ask the shop owner to change this one.';

type SaleRow = Record<string, unknown> & {
  id: string;
  organizationId: string;
  shopId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  size?: string | null;
  color?: string | null;
  costPrice?: number | null;
  discountAmount?: number | null;
  paymentBreakdown?: unknown;
};

export type SaleEditResult =
  | { ok: true; sale: Record<string, unknown> }
  | { ok: false; status: number; error: string; code: string };

const fail = (status: number, error: string, code = 'VALIDATION_ERROR'): SaleEditResult => ({ ok: false, status, error, code });

/**
 * Applies an edit body ({ quantity, unitPrice, paymentMethod, customerName,
 * customerPhone, notes, discountAmount } — all optional) to [sale]. A
 * quantity change moves stock by the difference (size × colour cell when the
 * product has a variant matrix), rejecting an increase the shop can't cover.
 */
export async function applySaleEdit(
  sale: SaleRow,
  body: Record<string, unknown>,
  actorPortalUserId: string | null,
): Promise<SaleEditResult> {
  const { quantity, unitPrice, paymentMethod, customerName, customerPhone, notes, discountAmount } = body;

  if (quantity !== undefined) {
    // Whole numbers unless the product is sold by weight/volume (kg, litre ...).
    const problem = typeof quantity === 'number' ? quantityError(quantity, await productUnit(sale.productId)) : 'Quantity must be a number';
    if (problem) return fail(400, problem);
  }
  if (unitPrice !== undefined && !(typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice >= 0)) {
    return fail(400, 'Unit price must be zero or more');
  }

  const updates: Record<string, unknown> = {};
  if (typeof quantity === 'number') updates.quantity = quantity;
  if (typeof unitPrice === 'number') updates.unitPrice = unitPrice;
  if (typeof paymentMethod === 'string' && paymentMethod) {
    updates.paymentMethod = paymentMethod;
    // Re-picking the method on a split sale replaces the split — keeping the
    // old breakdown would contradict the new single method.
    if (sale.paymentBreakdown != null) updates.paymentBreakdown = null;
  }
  if (customerName !== undefined) updates.customerName = customerName;
  if (customerPhone !== undefined) updates.customerPhone = customerPhone;
  if (notes !== undefined) updates.notes = notes;

  const newQuantity = typeof quantity === 'number' ? quantity : sale.quantity;
  const newUnitPrice = typeof unitPrice === 'number' ? unitPrice : Number(sale.unitPrice);
  const gross = newQuantity * newUnitPrice;
  // A discount sent with the edit replaces the old one; otherwise keep the
  // existing discount, capped at the new gross — recomputing a plain
  // quantity × unitPrice would silently undo it.
  const oldDiscount = Number(sale.discountAmount) || 0;
  let keptDiscount = Math.min(oldDiscount, gross);
  if (discountAmount !== undefined) {
    const requested = parseSaleDiscount(discountAmount, gross);
    if (typeof requested !== 'number') return fail(400, requested.error);
    keptDiscount = requested;
  }
  if (keptDiscount !== oldDiscount) updates.discountAmount = keptDiscount;
  const totalAmount = gross - keptDiscount;
  updates.totalAmount = totalAmount;
  const now = new Date().toISOString();
  updates.updatedAt = now;

  // Stock first: an increase the shop can't cover must fail before the sale
  // changes. Undone below if the sale update itself then fails.
  const delta = newQuantity - sale.quantity;
  const stock = delta !== 0 ? await moveStock(sale, delta) : null;
  if (stock && !stock.ok) return fail(409, stock.error, 'INSUFFICIENT_STOCK');

  const { data: updated, error } = await supabaseAdmin
    .from('SalesEntry')
    .update(updates)
    .eq('id', sale.id)
    .select()
    .single();
  if (error || !updated) {
    logger.error('Sale edit: update failed', { saleId: sale.id, error: error?.message });
    if (stock?.ok) await moveStock(sale, -delta);
    return fail(500, 'Failed to update sale', 'INTERNAL_ERROR');
  }

  if (stock?.ok) {
    await supabaseAdmin.from('StockTransaction').insert([{
      id: uuidv4(),
      organizationId: sale.organizationId,
      shopStockId: stock.shopStockId,
      portalUserId: actorPortalUserId,
      type: 'adjustment',
      quantity: -delta,
      size: stock.variant ? stock.size : null,
      color: stock.variant ? stock.color : null,
      reason: 'Sale edited',
      reference: `sale-edit-${sale.id}`,
      createdAt: now,
    }]);
    try {
      await syncProductStockFromShopStocks(sale.productId);
    } catch (e) {
      logger.warn('Sale edit: product stock sync failed', { productId: sale.productId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await updateProfitMargin(sale, newQuantity, totalAmount, now);
  return { ok: true, sale: updated as Record<string, unknown> };
}

type StockMove =
  | { ok: true; shopStockId: string; variant: boolean; size: string; color: string }
  | { ok: false; error: string };

/** Takes [delta] more units out of the shop (negative = puts them back). */
async function moveStock(sale: SaleRow, delta: number): Promise<StockMove | null> {
  const { data: shopStock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, quantity')
    .eq('shopId', sale.shopId)
    .eq('productId', sale.productId)
    .maybeSingle();
  if (!shopStock) {
    // Product since removed from this shop — the sale can still be corrected.
    logger.warn('Sale edit: no ShopStock row to adjust', { saleId: sale.id, shopId: sale.shopId, productId: sale.productId });
    return null;
  }
  const id = shopStock.id as string;
  const size = (sale.size ?? '').trim();
  const color = (sale.color ?? '').trim();
  const variant = Boolean(size || color) && (await hasVariantStock(id));

  if (variant) {
    if (delta > 0) {
      const dec = await decrementCell(id, size, color, delta);
      if (!dec.ok) return { ok: false, error: dec.available > 0 ? `Only ${dec.available} more in stock` : dec.error };
    } else {
      await incrementCell(id, sale.organizationId, size, color, -delta);
    }
  } else {
    const available = Number(shopStock.quantity) || 0;
    if (delta > available) return { ok: false, error: `Only ${available} more in stock` };
    await supabaseAdmin.from('ShopStock').update({ quantity: available - delta, updatedAt: new Date().toISOString() }).eq('id', id);
  }
  return { ok: true, shopStockId: id, variant, size, color };
}

/** Keeps a legacy ProfitMargin row (if any) in step, costed from the sale's own cost snapshot. */
async function updateProfitMargin(sale: SaleRow, quantity: number, sellingPrice: number, now: string): Promise<void> {
  const { data: margin } = await supabaseAdmin.from('ProfitMargin').select('id').eq('salesEntryId', sale.id).maybeSingle();
  if (!margin) return;
  let unitCost = Number(sale.costPrice) || 0;
  if (!unitCost) {
    const { data: product } = await supabaseAdmin.from('Product').select('costPrice').eq('id', sale.productId).maybeSingle();
    unitCost = Number(product?.costPrice) || 0;
  }
  const cost = unitCost * quantity;
  const profit = sellingPrice - cost;
  await supabaseAdmin
    .from('ProfitMargin')
    .update({ costPrice: cost, sellingPrice, profit, marginPercentage: sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0, updatedAt: now })
    .eq('salesEntryId', sale.id);
}
