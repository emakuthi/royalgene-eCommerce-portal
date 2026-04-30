import { NextRequest } from 'next/server';
import { generateToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import bcrypt from 'bcryptjs';
import { jsonResponse } from '@/lib/apiResponse';
import type { PortalUser as PortalUserType } from '@/lib/types';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';

/**
 * POST /api/mobile/auth/login
 * Authenticate shopkeeper and return JWT token
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      logger.warn('Mobile login failed: missing credentials', { 
        endpoint: '/api/mobile/auth/login',
        hasEmail: !!email,
        hasPassword: !!password
      });
      return jsonResponse({ 
        success: false, 
        error: 'Email and password are required',
        code: 'VALIDATION_ERROR'
      }, 400);
    }

    // Find user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (userError || !user) {
      logger.warn('Mobile login failed: user not found', { 
        email,
        endpoint: '/api/mobile/auth/login'
      });
      return jsonResponse({ 
        success: false, 
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      }, 401);
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      logger.warn('Mobile login failed: invalid password', { 
        email,
        endpoint: '/api/mobile/auth/login'
      });
      void trackActivity({
        userId: user.id, userEmail: email, userRole: user.role,
        action: 'auth.login_failed', category: 'auth', source: 'mobile',
        endpoint: '/api/mobile/auth/login', httpMethod: 'POST',
        ipAddress: extractClientIp(request), userAgent: request.headers.get('user-agent'),
        deviceType: detectDeviceType(request.headers.get('user-agent')),
        status: 'failure', errorMessage: 'Invalid password',
      });
      return jsonResponse({
        success: false, 
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      }, 401);
    }

    const isAdmin = user.role === 'admin' || user.role === 'super_admin';

    // Look up portal user record (shopkeeper link) – optional for admins
    const { data: portalUsers, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('*, Shop(*)')
      .eq('userId', user.id);

    const portalUser = portalUsers && portalUsers.length > 0 ? portalUsers[0] : null;

    // Non-admin users MUST have a PortalUser record
    if (!isAdmin && (portalError || !portalUser)) {
      logger.warn('Mobile login failed: not a portal user', { 
        userId: user.id,
        email,
        endpoint: '/api/mobile/auth/login'
      });
      return jsonResponse({ 
        success: false, 
        error: 'This account is not authorized for mobile app access',
        code: 'FORBIDDEN'
      }, 403);
    }

    // For portal users, check the mobileAccess flag
    if (!isAdmin && portalUser) {
      const mobileAccess = (portalUser as Record<string, unknown>).mobileAccess;
      if (mobileAccess === false) {
        logger.warn('Mobile login denied: mobileAccess is disabled', {
          userId: user.id,
          email,
          portalUserId: portalUser.id,
          endpoint: '/api/mobile/auth/login'
        });
        return jsonResponse({
          success: false,
          error: 'Mobile access has been disabled for this account. Contact your administrator.',
          code: 'MOBILE_ACCESS_DISABLED'
        }, 403);
      }
    }

    // Determine shopId – portal users have one, admins may not
    const shopId = portalUser?.shopId ?? null;

    // Create JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      shopId
    });

    // Get shop details (if user has a linked shop)
    let shop: Record<string, unknown> | null = null;
    if (shopId) {
      const { data: shopRow } = await supabaseAdmin
        .from('Shop')
        .select('id, name, location, phone, address')
        .eq('id', shopId)
        .single();
      shop = shopRow as Record<string, unknown> | null;
    }

    // For admin users without a specific shop, fetch all shops they can manage
    let allShops: Array<Record<string, unknown>> | null = null;
    if (isAdmin && !shopId) {
      const { data: shops } = await supabaseAdmin
        .from('Shop')
        .select('id, name, location, phone, address')
        .eq('isActive', true)
        .order('name', { ascending: true });
      allShops = (shops as Array<Record<string, unknown>>) ?? [];
    }

    const duration = Date.now() - startTime;
    logger.info('Mobile login successful', { 
      userId: user.id,
      email,
      role: user.role,
      shopId,
      isAdmin,
      duration,
      endpoint: '/api/mobile/auth/login'
    });

    // Track successful mobile login
    void trackActivity({
      userId: user.id, userEmail: user.email, userRole: user.role,
      action: 'auth.login', category: 'auth', source: 'mobile',
      endpoint: '/api/mobile/auth/login', httpMethod: 'POST',
      shopId: shopId ?? undefined,
      ipAddress: extractClientIp(request), userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent')),
      status: 'success', durationMs: duration,
      details: { isAdmin, shopCount: allShops?.length ?? (shopId ? 1 : 0) },
    });

    const formatShop = (s: Record<string, unknown>) => {
      const phoneVal = s['phone'];
      const fallbackPhoneVal = s['phoneNumber'];
      const phoneNumber = typeof phoneVal === 'string' ? phoneVal : (typeof fallbackPhoneVal === 'string' ? fallbackPhoneVal : null);
      return {
        id: typeof s['id'] === 'string' ? s['id'] : (typeof s['id'] === 'number' ? String(s['id']) : undefined),
        name: typeof s['name'] === 'string' ? s['name'] : undefined,
        location: typeof s['location'] === 'string' ? s['location'] : undefined,
        phoneNumber,
        address: typeof s['address'] === 'string' ? s['address'] : undefined
      };
    };

    return jsonResponse({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role
        },
        shop: shop ? formatShop(shop) : null,
        // Only present for admins without a specific shop – lets them pick one
        shops: allShops ? allShops.map(formatShop) : undefined
      },
      message: 'Login successful'
    }, 200);

  } catch (error) {
    logger.error('Mobile login error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/auth/login'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

