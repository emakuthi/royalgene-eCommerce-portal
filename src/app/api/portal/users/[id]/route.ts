import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken, type VerifiedPayload } from '@/lib/auth.server';
import { assertTenantMatch } from '@/lib/tenant-guard';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

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

// PATCH /api/portal/users/[id] — update position, shopId, isActive, name, email
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name, email, position, shopId, isActive, mobileAccess } = await request.json();

  // Fetch existing portal user to get userId — an org "admin" (not platform
  // super_admin) may only ever touch a PortalUser belonging to their own org.
  const { data: pu, error: fetchError } = await supabaseAdmin
    .from('PortalUser').select('id, userId, organizationId').eq('id', id).single();
  if (fetchError || !pu) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);

  if (auth.organizationId && pu.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // If reassigning to a different shop, that shop must be in the same organization.
  if (shopId !== undefined) {
    const { data: shopCheck } = await supabaseAdmin
      .from('Shop')
      .select('id, organizationId')
      .eq('id', shopId)
      .maybeSingle();
    if (!shopCheck || shopCheck.organizationId !== pu.organizationId) {
      return jsonResponse({ success: false, error: 'Forbidden: shop does not belong to this organization' }, 403);
    }
  }

  // Update PortalUser fields
  const puUpdate: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (position !== undefined) puUpdate.position = position;
  if (shopId !== undefined) puUpdate.shopId = shopId;
  if (isActive !== undefined) puUpdate.isActive = isActive;
  if (mobileAccess !== undefined) puUpdate.mobileAccess = mobileAccess;

  const { error: puError } = await supabaseAdmin.from('PortalUser').update(puUpdate).eq('id', id);
  if (puError) return jsonResponse({ success: false, error: puError.message }, 500);

  // Update User fields if provided
  if (name !== undefined || email !== undefined) {
    const userUpdate: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) userUpdate.name = name;
    if (email !== undefined) userUpdate.email = email;
    const { error: uError } = await supabaseAdmin.from('User').update(userUpdate).eq('id', pu.userId);
    if (uError) return jsonResponse({ success: false, error: uError.message }, 500);
  }

  // Return updated record
  const { data: updated } = await supabaseAdmin
    .from('PortalUser')
    .select('id, userId, shopId, position, isActive, mobileAccess, createdAt, user:User(id,name,email,phone), shop:Shop(id,name,location)')
    .eq('id', id)
    .single();

  return jsonResponse({ success: true, data: updated });
}

// DELETE /api/portal/users/[id] — remove a PortalUser (and its User row when
// it isn't shared). If the person has sales / stock history their row can't be
// deleted, so we deactivate the login instead and say so.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const { data: pu } = await supabaseAdmin
    .from('PortalUser').select('userId, organizationId').eq('id', id).maybeSingle();
  if (!pu) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);
  if (auth.organizationId && pu.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  const { error } = await supabaseAdmin.from('PortalUser').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      await supabaseAdmin
        .from('PortalUser')
        .update({ isActive: false, mobileAccess: false, updatedAt: new Date().toISOString() })
        .eq('id', id);
      return jsonResponse({
        success: true,
        data: { deactivated: true },
        message: 'This person has sales or stock history, so their access was disabled instead of deleted.',
      });
    }
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  // Remove the underlying User row only when it's a plain portal_user with no
  // other shop membership left; ignore an FK error (leaves a harmless orphan).
  if (pu.userId) {
    const [{ data: userRow }, { data: otherMemberships }] = await Promise.all([
      supabaseAdmin.from('User').select('role').eq('id', pu.userId).maybeSingle(),
      supabaseAdmin.from('PortalUser').select('id').eq('userId', pu.userId).limit(1),
    ]);
    if (userRow?.role === 'portal_user' && (!otherMemberships || otherMemberships.length === 0)) {
      await supabaseAdmin.from('User').delete().eq('id', pu.userId);
    }
  }

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
