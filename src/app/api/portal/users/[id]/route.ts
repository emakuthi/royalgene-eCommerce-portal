import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

function requireAdmin(request: NextRequest): NextResponse | ReturnType<typeof verifyToken> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  const payload = verifyToken(token);
  if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin' && payload.role !== 'super_admin')
    return jsonResponse({ success: false, error: 'Admin access required' }, 403);
  return payload;
}

// PATCH /api/portal/users/[id] — update position, shopId, isActive, name, email
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name, email, position, shopId, isActive, mobileAccess } = await request.json();

  // Fetch existing portal user to get userId
  const { data: pu, error: fetchError } = await supabaseAdmin
    .from('PortalUser').select('id, userId').eq('id', id).single();
  if (fetchError || !pu) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);

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

// DELETE /api/portal/users/[id] — delete PortalUser (and optionally the User row)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Get userId first
  const { data: pu } = await supabaseAdmin.from('PortalUser').select('userId').eq('id', id).single();

  const { error } = await supabaseAdmin.from('PortalUser').delete().eq('id', id);
  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  // Also delete the underlying User row (portal_user role only)
  if (pu?.userId) {
    const { data: userRow } = await supabaseAdmin.from('User').select('role').eq('id', pu.userId).single();
    if (userRow?.role === 'portal_user') {
      await supabaseAdmin.from('User').delete().eq('id', pu.userId);
    }
  }

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
