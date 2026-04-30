import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

// Use `unknown` for the context and perform a type-safe normalization below.
export async function PATCH(request: NextRequest, context: unknown) {
  const start = Date.now();
  try {
    // Next.js typing can sometimes provide params wrapped in a Promise or as a plain object.
    // Resolve `context` safely and extract `params.id` with runtime checks (no `any`).
    const resolvedContext = await Promise.resolve(context as unknown);
    let saleId: string | undefined = undefined;
    if (resolvedContext && typeof resolvedContext === 'object') {
      const ctxObj = resolvedContext as Record<string, unknown>;
      const params = ctxObj['params'];
      if (params && typeof params === 'object') {
        const paramsObj = params as Record<string, unknown>;
        const idVal = paramsObj['id'];
        if (typeof idVal === 'string') saleId = idVal;
      }
    }
    if (!saleId) return jsonResponse({ success: false, error: 'Missing sale id' }, 400);

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

    const body = await request.json();
    const { quantity, unitPrice, paymentMethod, customerName, customerPhone, notes } = body;

    // Fetch existing sale
    const { data: existingSale, error: saleErr } = await supabaseAdmin
      .from('SalesEntry')
      .select('*')
      .eq('id', saleId)
      .single();

    if (saleErr || !existingSale) {
      return jsonResponse({ success: false, error: 'Sale not found' }, 404);
    }

    // Verify portal user permissions: the token user must be the portalUser or an admin
    const { data: portalUser } = await supabaseAdmin
      .from('PortalUser')
      .select('*')
      .eq('userId', payload.userId)
      .single();

    if (!portalUser) return jsonResponse({ success: false, error: 'Portal user not found' }, 403);
    if (portalUser.shopId !== existingSale.shopId && payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }

    // Prepare updates with explicit typed shape
    type UpdatePayload = Partial<{
      quantity: number;
      unitPrice: number;
      paymentMethod: string;
      customerName: string | null;
      customerPhone: string | null;
      notes: string | null;
      totalAmount: number;
      updatedAt: string;
    }>;

    const updates: UpdatePayload = {};
    if (typeof quantity === 'number') updates.quantity = quantity;
    if (typeof unitPrice === 'number') updates.unitPrice = unitPrice;
    if (paymentMethod) updates.paymentMethod = paymentMethod;
    if (typeof customerName !== 'undefined') updates.customerName = customerName;
    if (typeof customerPhone !== 'undefined') updates.customerPhone = customerPhone;
    if (typeof notes !== 'undefined') updates.notes = notes;

    // Recompute totalAmount if quantity or unitPrice changed
    const newQuantity = typeof updates.quantity === 'number' ? updates.quantity : existingSale.quantity;
    const newUnitPrice = typeof updates.unitPrice === 'number' ? updates.unitPrice : existingSale.unitPrice;
    const newTotalAmount = newQuantity * newUnitPrice;
    updates.totalAmount = newTotalAmount;

    const now = new Date().toISOString();
    updates.updatedAt = now;

    // Update the sale
    const { data: updatedSale, error: updateErr } = await supabaseAdmin
      .from('SalesEntry')
      .update(updates)
      .eq('id', saleId)
      .select()
      .single();

    if (updateErr) {
      logger.error('Failed to update SalesEntry', { error: updateErr.message });
      return jsonResponse({ success: false, error: 'Failed to update sale' }, 500);
    }

    // Update ProfitMargin record if present
    const { data: profit, error: profitErr } = await supabaseAdmin
      .from('ProfitMargin')
      .select('*')
      .eq('salesEntryId', saleId)
      .single();

    if (!profitErr && profit) {
      // fetch product cost price
      const { data: product } = await supabaseAdmin
        .from('Product')
        .select('*')
        .eq('id', existingSale.productId)
        .single();

      const costPrice = product?.price || 0;
      const sellingPrice = newTotalAmount;
      const profitValue = sellingPrice - (costPrice * newQuantity);
      const marginPercentage = sellingPrice > 0 ? (profitValue / sellingPrice) * 100 : 0;

      await supabaseAdmin
        .from('ProfitMargin')
        .update({
          costPrice: costPrice * newQuantity,
          sellingPrice,
          profit: profitValue,
          marginPercentage,
          updatedAt: now,
        })
        .eq('salesEntryId', saleId);
    }

    // Update ShopStock if exists: adjust by delta (oldQuantity -> newQuantity)
    const delta = newQuantity - existingSale.quantity;
    if (delta !== 0) {
      const { data: shopStock } = await supabaseAdmin
        .from('ShopStock')
        .select('*')
        .eq('shopId', existingSale.shopId)
        .eq('productId', existingSale.productId)
        .single();

      if (shopStock) {
        // subtract delta since a positive delta means more sold (decrease stock)
        const newQty = Math.max(0, shopStock.quantity - delta);
        await supabaseAdmin
          .from('ShopStock')
          .update({ quantity: newQty, updatedAt: now })
          .eq('id', shopStock.id);

        // record transaction
        await supabaseAdmin
          .from('StockTransaction')
          .insert([{ id: cryptoRandomId(), shopStockId: shopStock.id, portalUserId: portalUser.id, type: 'adjustment', quantity: -delta, reason: 'Sale update', reference: saleId, createdAt: now }]);
      }
    }

    logger.info('Sales entry updated', { saleId, userId: payload.userId, duration: Date.now() - start });

    return jsonResponse({ success: true, data: updatedSale }, 200);
  } catch (err) {
    logger.error('Sales update error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}

function cryptoRandomId() {
  // Simple unique id for transactions (not cryptographically required here)
  return 'tx_' + Math.random().toString(36).slice(2, 11);
}
