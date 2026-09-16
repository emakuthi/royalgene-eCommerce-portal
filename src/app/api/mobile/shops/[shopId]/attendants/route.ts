import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, hashPassword, type VerifiedPayload } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { assertCanCreate } from '@/lib/entitlements/enforce.server';
import logger from '@/lib/logger';
import { isValidEmail, normalizeEmail } from '@/lib/email-validation';

// Attendants of a shop = PortalUser rows (role portal_user on the User).
// GET  -> list this shop's attendants
// POST -> create a User + PortalUser for this shop. Admin / super_admin only.

const VALID_POSITIONS = ['shopkeeper', 'shop_manager', 'shop_owner', 'cashier', 'assistant'];

type LoadResult =
  | { error: Response }
  | { error?: undefined; payload: VerifiedPayload; shop: { id: string; name: string; organizationId: string }; organizationId: string };

async function loadShop(request: NextRequest, shopId: string): Promise<LoadResult> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return { error: jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401) };
  const payload = verifyToken(token);
  if (!payload) return { error: jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401) };
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return { error: jsonResponse({ success: false, error: 'Only workspace admins can manage attendants', code: 'FORBIDDEN' }, 403) };
  }

  const { data: shop } = await supabaseAdmin
    .from('Shop')
    .select('id, name, organizationId')
    .eq('id', shopId)
    .maybeSingle();
  if (!shop) return { error: jsonResponse({ success: false, error: 'Shop not found', code: 'NOT_FOUND' }, 404) };

  const organizationId = (payload.organizationId ?? shop.organizationId) as string;
  if (shop.organizationId !== organizationId) {
    return { error: jsonResponse({ success: false, error: 'Shop does not belong to your organization', code: 'FORBIDDEN' }, 403) };
  }
  return { payload, shop: shop as { id: string; name: string; organizationId: string }, organizationId };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await ctx.params;
  const res = await loadShop(request, shopId);
  if ('error' in res) return res.error;

  const { data, error } = await supabaseAdmin
    .from('PortalUser')
    .select('id, userId, shopId, position, isActive, mobileAccess, createdAt, user:User(id, name, email, phone)')
    .eq('shopId', shopId)
    .order('createdAt', { ascending: true });

  if (error) {
    logger.error('Mobile attendants list failed', { error: error.message, shopId });
    return jsonResponse({ success: false, error: 'Failed to load attendants', code: 'INTERNAL_ERROR' }, 500);
  }
  return jsonResponse({ success: true, data: { attendants: data ?? [] } });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await ctx.params;
  const res = await loadShop(request, shopId);
  if ('error' in res) return res.error;
  const { organizationId } = res;

  const body = await request.json().catch(() => ({}));
  const { name, email, password, position = 'shopkeeper', mobileAccess = true } = body as {
    name?: string; email?: string; password?: string; position?: string; mobileAccess?: boolean;
  };

  if (!name?.trim() || !email?.trim() || !password) {
    return jsonResponse({ success: false, error: 'name, email and password are required', code: 'VALIDATION_ERROR' }, 400);
  }
  if (!isValidEmail(email)) {
    return jsonResponse({ success: false, error: 'Enter a valid email address', code: 'VALIDATION_ERROR' }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ success: false, error: 'Password must be at least 8 characters', code: 'VALIDATION_ERROR' }, 400);
  }
  if (!VALID_POSITIONS.includes(position)) {
    return jsonResponse({ success: false, error: `position must be one of: ${VALID_POSITIONS.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  const limitResponse = await assertCanCreate(organizationId, 'USER');
  if (limitResponse) return limitResponse;

  const normalizedEmail = normalizeEmail(email);
  // One email = one account, across every workspace.
  const { data: existingRows } = await supabaseAdmin
    .from('User')
    .select('id, organizationId')
    .eq('email', normalizedEmail)
    .limit(1);
  if (existingRows && existingRows.length > 0) {
    const sameOrg = existingRows[0].organizationId === organizationId;
    return jsonResponse({
      success: false,
      error: sameOrg
        ? 'Someone with that email is already on this workspace'
        : 'That email already belongs to another account. Use a different email for this attendant.',
      code: 'DUPLICATE_EMAIL',
    }, 409);
  }

  const now = new Date().toISOString();
  const userId = uuidv4();
  const { error: userError } = await supabaseAdmin.from('User').insert([{
    id: userId,
    email: normalizedEmail,
    password: await hashPassword(password),
    name: name.trim(),
    role: 'portal_user',
    twoFactorEnabled: false,
    organizationId,
    createdAt: now,
    updatedAt: now,
  }]);
  if (userError) {
    if (userError.code === '23505') return jsonResponse({ success: false, error: 'That email is already registered', code: 'DUPLICATE_EMAIL' }, 409);
    logger.error('Mobile add attendant: user insert failed', { error: userError.message, shopId });
    return jsonResponse({ success: false, error: 'Failed to create attendant', code: 'INTERNAL_ERROR' }, 500);
  }

  const { data: portalUser, error: puError } = await supabaseAdmin
    .from('PortalUser')
    .insert([{
      id: uuidv4(), userId, shopId, position, isActive: true, mobileAccess,
      organizationId, createdAt: now, updatedAt: now,
    }])
    .select('id, userId, shopId, position, isActive, mobileAccess, createdAt, user:User(id, name, email, phone)')
    .single();

  if (puError) {
    await supabaseAdmin.from('User').delete().eq('id', userId);
    logger.error('Mobile add attendant: portalUser insert failed', { error: puError.message, shopId });
    return jsonResponse({ success: false, error: 'Failed to create attendant', code: 'INTERNAL_ERROR' }, 500);
  }

  logger.info('Mobile attendant added', { shopId, portalUserId: portalUser.id });
  return jsonResponse({ success: true, data: portalUser }, 201);
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
