import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { hashPassword, generateToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import type { TokenUser } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

// In a production system, invitation codes would be stored in a separate table
// For now, we'll use a simple validation approach
const VALID_INVITATION_CODES: Record<string, { shopId: string; position: string }> = {
  'SHOP001-ADMIN': { shopId: 'placeholder-shop-1', position: 'manager' },
  'SHOP001-STAFF': { shopId: 'placeholder-shop-1', position: 'staff' },
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { email, password, name, phone, invitationCode } = await request.json();
    logger.info('Portal registration attempt', { email, name, invitationCode, endpoint: '/api/portal/auth/register' });

    // Validate input
    if (!email || !password || !name || !invitationCode) {
      logger.warn('Portal registration failed: missing fields', { email, endpoint: '/api/portal/auth/register' });
      return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
    }

    if (password.length < 8) {
      logger.warn('Portal registration failed: password too short', { email, endpoint: '/api/portal/auth/register' });
      return jsonResponse({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      logger.warn('Portal registration failed: email already in use', { email, endpoint: '/api/portal/auth/register' });
      return jsonResponse({ success: false, error: 'Email already in use' }, 400);
    }

    // Validate invitation code
    const invitationData = VALID_INVITATION_CODES[invitationCode];
    if (!invitationData) {
      logger.warn('Portal registration failed: invalid invitation code', { email, code: invitationCode, endpoint: '/api/portal/auth/register' });
      return jsonResponse({ success: false, error: 'Invalid invitation code' }, 400);
    }

    // Check if shop exists
    const { data: shop } = await supabaseAdmin
      .from('Shop')
      .select('*')
      .eq('isActive', true)
      .limit(1)
      .single();

    if (!shop) {
      logger.error('Portal registration failed: no active shop available', { email, endpoint: '/api/portal/auth/register' });
      return jsonResponse({ success: false, error: 'No active shop available. Contact administrator.' }, 400);
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const userId = uuidv4();
    const now = new Date().toISOString();

    const { error: userError } = await supabaseAdmin
      .from('User')
      .insert([{
        id: userId,
        email,
        password: hashedPassword,
        name,
        phone: phone || null,
        role: 'portal_user',
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      }]);

    if (userError) {
      throw new Error(userError.message);
    }

    // Create portal user
    const portalUserId = uuidv4();
    const { data: portalUserData, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .insert([{
        id: portalUserId,
        userId,
        shopId: shop.id,
        position: (invitationData.position as 'shopkeeper' | 'staff' | 'manager') || 'staff',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }])
      .select()
      .single();

    if (portalError) {
      throw new Error(portalError.message);
    }

    const user = {
      id: userId,
      email,
      name,
      role: 'portal_user',
    };

    const tokenUser: TokenUser = { id: user.id, email: user.email, role: 'portal_user' };
    const token = generateToken(tokenUser);

    logger.info('Portal registration successful', {
      userId,
      email,
      shopId: shop.id,
      endpoint: '/api/portal/auth/register',
      duration: Date.now() - startTime
    });

    return jsonResponse({ success: true, data: { user, portalUser: portalUserData, token } }, 201);
  } catch (error) {
    logger.error('Portal registration error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/auth/register',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
