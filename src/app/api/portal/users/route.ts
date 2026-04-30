import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken, hashPassword } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';

function requireAdmin(request: NextRequest): NextResponse | ReturnType<typeof verifyToken> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  const payload = verifyToken(token);
  if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin' && payload.role !== 'super_admin')
    return jsonResponse({ success: false, error: 'Admin access required' }, 403);
  return payload;
}

// GET /api/portal/users — list all portal users with user + shop info
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
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

  if (error) return jsonResponse({ success: false, error: error.message }, 500);
  return jsonResponse({ success: true, data: data ?? [] });
}

// POST /api/portal/users — create User + PortalUser
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { name, email, password, position, shopId, isActive = true, mobileAccess = true } = await request.json();

  if (!name || !email || !password || !position || !shopId)
    return jsonResponse({ success: false, error: 'name, email, password, position and shopId are required' }, 400);

  if (password.length < 8)
    return jsonResponse({ success: false, error: 'Password must be at least 8 characters' }, 400);

  // Check email uniqueness
  const { data: existing } = await supabaseAdmin.from('User').select('id').eq('email', email).single();
  if (existing) return jsonResponse({ success: false, error: 'Email already in use' }, 409);

  const now = new Date().toISOString();
  const userId = uuidv4();
  const hashed = await hashPassword(password);

  const { error: userError } = await supabaseAdmin.from('User').insert([{
    id: userId, email, password: hashed, name,
    role: 'portal_user', twoFactorEnabled: false,
    createdAt: now, updatedAt: now,
  }]);
  if (userError) return jsonResponse({ success: false, error: userError.message }, 500);

  const portalUserId = uuidv4();
  const { data: portalUser, error: puError } = await supabaseAdmin
    .from('PortalUser')
    .insert([{ id: portalUserId, userId, shopId, position, isActive, mobileAccess, createdAt: now, updatedAt: now }])
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
