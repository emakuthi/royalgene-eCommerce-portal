import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { assertTenantMatch } from '@/lib/tenant-guard';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';

function requireAdmin(request: NextRequest): NextResponse | VerifiedPayload {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  const payload = verifyToken(token);
  if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin' && payload.role !== 'super_admin')
    return jsonResponse({ success: false, error: 'Admin access required' }, 403);
  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;
  return payload;
}

/**
 * POST /api/portal/users/[id]/shops
 * [id] = userId (User table)
 * Body: { shopId: string }
 * Creates a new PortalUser record linking this user to the given shop.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id: userId } = await params;
  const { shopId } = await request.json();

  if (!shopId) return jsonResponse({ success: false, error: 'shopId is required' }, 400);

  // Check the user exists and get their position from an existing PortalUser record.
  // Org "admin" (not super_admin) may only manage users already in their own org.
  const { data: existingPU } = await supabaseAdmin
    .from('PortalUser')
    .select('position, organizationId')
    .eq('userId', userId)
    .limit(1)
    .single();

  if (!existingPU) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);
  if (auth.organizationId && existingPU.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // The shop being assigned must belong to the same organization.
  const { data: shopCheck } = await supabaseAdmin
    .from('Shop')
    .select('id, organizationId')
    .eq('id', shopId)
    .maybeSingle();
  if (!shopCheck || shopCheck.organizationId !== existingPU.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden: shop does not belong to this organization' }, 403);
  }

  // Prevent duplicate shop assignment
  const { data: duplicate } = await supabaseAdmin
    .from('PortalUser')
    .select('id')
    .eq('userId', userId)
    .eq('shopId', shopId)
    .limit(1)
    .single();

  if (duplicate) return jsonResponse({ success: false, error: 'User is already assigned to this shop' }, 409);

  const now = new Date().toISOString();
  const portalUserId = uuidv4();

  const { data: newEntry, error } = await supabaseAdmin
    .from('PortalUser')
    .insert([{
      id: portalUserId,
      organizationId: existingPU.organizationId,
      userId,
      shopId,
      position: existingPU.position,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }])
    .select(`id, userId, shopId, position, isActive, shop:Shop(id, name, location)`)
    .single();

  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  // Return in ShopAssignment shape expected by the UI
  return jsonResponse({
    success: true,
    data: {
      portalUserId: newEntry.id,
      shopId: newEntry.shopId,
      shop: newEntry.shop,
      position: newEntry.position,
      isActive: newEntry.isActive,
    },
  }, 201);
}

/**
 * DELETE /api/portal/users/[id]/shops
 * [id] = userId (User table)
 * Body: { shopId: string }
 * Deletes the PortalUser record linking this user to the given shop.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id: userId } = await params;
  const { shopId } = await request.json();

  if (!shopId) return jsonResponse({ success: false, error: 'shopId is required' }, 400);

  // Org "admin" may only manage users already in their own org.
  if (auth.organizationId) {
    const { data: ownerCheck } = await supabaseAdmin
      .from('PortalUser')
      .select('id')
      .eq('userId', userId)
      .eq('organizationId', auth.organizationId)
      .limit(1)
      .maybeSingle();
    if (!ownerCheck) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // Prevent removing the last shop assignment
  const { count } = await supabaseAdmin
    .from('PortalUser')
    .select('id', { count: 'exact', head: true })
    .eq('userId', userId);

  if ((count ?? 0) <= 1) {
    return jsonResponse({ success: false, error: 'Cannot remove the last shop assignment. Delete the user instead.' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('PortalUser')
    .delete()
    .eq('userId', userId)
    .eq('shopId', shopId);

  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('POST,DELETE,OPTIONS');
}
