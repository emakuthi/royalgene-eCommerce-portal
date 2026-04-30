import { NextRequest } from 'next/server';
import bcryptjs from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-client';
import { generateToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import type { User } from '@/lib/types';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { email, password } = await request.json();
    logger.info('Portal login attempt', { email, endpoint: '/api/portal/auth/login', method: 'POST' });

    // Find user
    const { data: userData, error: userError } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !userData) {
      logger.warn('Portal login failed: user not found', { email, endpoint: '/api/portal/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
    }

    const user = userData;

    // Check if user is portal_user or admin
    if (user.role !== 'portal_user' && user.role !== 'admin' && user.role !== 'super_admin') {
      logger.warn('Portal login failed: invalid role', { email, role: user.role, endpoint: '/api/portal/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Check password
    const passwordMatch = await bcryptjs.compare(password, user.password);

    if (!passwordMatch) {
      logger.warn('Portal login failed: password mismatch', { email, endpoint: '/api/portal/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Get portal user details if portal_user role
    let portalUser = null;
    let shop = null;

    if (user.role === 'portal_user') {
      const { data: portalUserData, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('id, userId, shopId, position, isActive, createdAt, updatedAt')
        .eq('userId', user.id)
        .single();

      if (portalError || !portalUserData) {
        logger.warn('Portal login failed: portal user not found', { userId: user.id, endpoint: '/api/portal/auth/login' });
        return jsonResponse({ success: false, error: 'Portal access denied' }, 403);
      }

      portalUser = portalUserData;

      if (!portalUser.isActive) {
        logger.warn('Portal login failed: portal user inactive', { userId: user.id, endpoint: '/api/portal/auth/login' });
        return jsonResponse({ success: false, error: 'Portal access denied' }, 403);
      }

      // Get shop details
      const { data: shopData } = await supabaseAdmin
        .from('Shop')
        .select('id, name, location')
        .eq('id', portalUser.shopId)
        .single();

      shop = shopData;

      // Update last login
      await supabaseAdmin
        .from('PortalUser')
        .update({ lastLogin: new Date().toISOString() })
        .eq('id', portalUser.id);
    }

    // Generate token with proper type conversion
    const typedUser: User = {
      ...user,
      role: user.role as 'customer' | 'admin' | 'portal_user' | 'super_admin',
      phone: user.phone ?? undefined,
      address: user.address ?? undefined,
    };
    const token = generateToken(typedUser);

    logger.info('Portal login successful', {
      userId: user.id,
      email,
      role: user.role,
      shopId: portalUser?.shopId,
      endpoint: '/api/portal/auth/login',
      duration: Date.now() - startTime
    });

    return jsonResponse({ success: true, data: { user: { id: user.id, email: user.email, name: user.name, role: user.role }, portalUser, shop, token } }, 200);
  } catch (error) {
    logger.error('Portal login error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/auth/login',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
