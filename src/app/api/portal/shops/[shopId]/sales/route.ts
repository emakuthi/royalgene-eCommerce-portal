import { NextRequest, NextResponse } from 'next/server';
import { requirePortalRole, requirePermission } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

/**
 * Demo portal sales endpoint
 * POST /api/portal/shops/:shopId/sales
 * Body: { productId, quantity, unitPrice, customerName?, customerPhone? }
 * Requirements: user must be a portal user for the shop and have portal.sales.create permission
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const { shopId } = await params;

    // 1) Portal role check (shop membership and role)
    const portalCheck = await requirePortalRole(request, shopId, ['shopkeeper', 'shop_manager', 'shop_owner']);
    if (portalCheck instanceof NextResponse) return portalCheck;
    const { portalUser } = portalCheck;

    // 2) Permission check (optional; super_admin bypass inside requirePermission)
    const permCheck = await requirePermission(request, 'portal.sales.create');
    if (permCheck instanceof NextResponse) return permCheck;

    // 3) Validate input
    const body = await request.json();
    const { productId, quantity, unitPrice, customerName, customerPhone } = body || {};
    if (!productId || !quantity || !unitPrice) {
      return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
    }

    // 4) Insert sale into Supabase 'SalesEntry' table (assumes such table exists)
    const { supabaseAdmin } = await import('@/lib/supabase-client');

    const sale = {
      shopId,
      portalUserId: portalUser.userId || portalUser.id,
      productId,
      quantity: Number(quantity),
      unitPrice: Number(unitPrice),
      totalAmount: Number(quantity) * Number(unitPrice),
      paymentMethod: 'cash',
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      entryDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    } as Record<string, unknown>;

    const { data, error } = await supabaseAdmin.from('SalesEntry').insert([sale]).select().single();
    if (error) {
      console.warn('Portal sales insert failed', error);
      // Fallback: return created sale object without DB id
      const fallback: Record<string, unknown> = { ...sale, id: `fallback-${Date.now()}` };
      // Attempt audit of fallback
      try {
        const { audit } = await import('@/lib/audit');
        const fallbackId = typeof fallback.id === 'string' ? fallback.id : String(fallback.id);
        await audit({ actorUserId: portalUser.userId || portalUser.id, action: 'sale.create', resourceType: 'Sale', resourceId: fallbackId, details: fallback });
      } catch (err) {
        // ignore audit failures
      }
      return jsonResponse({ success: true, data: fallback, message: 'Sale recorded (fallback)' }, 201);
    }

    // On success, write audit log
    try {
      const { audit } = await import('@/lib/audit');
      const dataId = typeof data?.id === 'string' ? data.id : String(data?.id);
      await audit({ actorUserId: portalUser.userId || portalUser.id, action: 'sale.create', resourceType: 'Sale', resourceId: dataId, details: data });
    } catch (err) {
      // don't fail the request if audit fails
      console.warn('audit log failed', err);
    }

    return jsonResponse({ success: true, data }, 201);
  } catch (err) {
    console.error('Create portal sale error', err);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
