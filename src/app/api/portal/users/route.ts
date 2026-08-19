import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken, hashPassword, type VerifiedPayload } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { assertTenantMatch } from '@/lib/tenant-guard';
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

// GET /api/portal/users — list portal users (within the caller's organization) with user + shop info
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let query = supabaseAdmin
    .from('PortalUser')
    .select(`
      id,
      userId,
      shopId,
      position,
      isActive,
      mobileAccess,
      createdAt,
      user:User ( id, name, email, phone, createdAt ),
      shop:Shop ( id, name, location )
    `)
    .order('createdAt', { ascending: false });

  // super_admin (organizationId null) can see across orgs; everyone else is
  // scoped to their own organization.
  if (auth.organizationId) {
    query = query.eq('organizationId', auth.organizationId);
  }

  const { data, error } = await query;

  if (error) return jsonResponse({ success: false, error: error.message }, 500);
  return jsonResponse({ success: true, data: data ?? [] });
}

// POST /api/portal/users — create User + PortalUser, scoped to the caller's organization
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { name, email, password, position, shopId, isActive = true, mobileAccess = true } = await request.json();

  if (!name || !email || !password || !position || !shopId)
    return jsonResponse({ success: false, error: 'name, email, password, position and shopId are required' }, 400);

  if (password.length < 8)
    return jsonResponse({ success: false, error: 'Password must be at least 8 characters' }, 400);

  // organizationId always comes from the acting admin's own token, never from
  // the request body — a super_admin (organizationId null) must still target
  // a real org, resolved here from the shop being assigned.
  const { data: targetShop, error: shopError } = await supabaseAdmin
    .from('Shop')
    .select('id, organizationId')
    .eq('id', shopId)
    .single();

  if (shopError || !targetShop) return jsonResponse({ success: false, error: 'Shop not found' }, 404);

  const organizationId = auth.organizationId ?? targetShop.organizationId;
  if (targetShop.organizationId !== organizationId) {
    return jsonResponse({ success: false, error: 'Shop does not belong to your organization' }, 403);
  }

  // Check email uniqueness within the organization
  const { data: existing } = await supabaseAdmin
    .from('User')
    .select('id')
    .eq('email', email)
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (existing) return jsonResponse({ success: false, error: 'Email already in use' }, 409);

  const now = new Date().toISOString();
  const userId = uuidv4();
  const hashed = await hashPassword(password);

  const { error: userError } = await supabaseAdmin.from('User').insert([{
    id: userId, email, password: hashed, name,
    role: 'portal_user', twoFactorEnabled: false, organizationId,
    createdAt: now, updatedAt: now,
  }]);
  if (userError) return jsonResponse({ success: false, error: userError.message }, 500);

  const portalUserId = uuidv4();
  const { data: portalUser, error: puError } = await supabaseAdmin
    .from('PortalUser')
    .insert([{ id: portalUserId, userId, shopId, position, isActive, mobileAccess, organizationId, createdAt: now, updatedAt: now }])
    .select(`id, userId, shopId, position, isActive, createdAt, user:User(id,name,email,phone), shop:Shop(id,name,location)`)
    .single();

  if (puError) {
    // Rollback user creation
    await supabaseAdmin.from('User').delete().eq('id', userId);
    return jsonResponse({ success: false, error: puError.message }, 500);
  }

  return jsonResponse({ success: true, data: portalUser }, 201);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
