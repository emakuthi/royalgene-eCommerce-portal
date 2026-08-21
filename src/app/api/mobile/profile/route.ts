import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * GET /api/mobile/profile
 * Get current user profile
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return jsonResponse({ 
        success: false, 
        error: 'Unauthorized',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid token',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    // Get user details
    const { data: user, error: userError } = await supabaseAdmin
      .from('User')
      .select('id, name, email, phone, role, organizationId')
      .eq('id', payload.userId)
      .single();

    if (userError || !user) {
      return jsonResponse({
        success: false,
        error: 'User not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // Organization identity — see login/route.ts for why this is included.
    let organization: { id: string; name: string; slug: string } | null = null;
    if (user.organizationId) {
      const { data: orgRow } = await supabaseAdmin
        .from('Organization')
        .select('id, name, slug')
        .eq('id', user.organizationId)
        .maybeSingle();
      organization = (orgRow as typeof organization) ?? null;
    }

    // Get portal user & shop details (user may have multiple shop assignments).
    // Admins/super_admins manage shops org-wide and are not required to have a
    // PortalUser link (mirrors the same exemption at mobile login and in
    // GET /api/mobile/shops) — only non-admin shopkeepers 404 without one.
    const isAdmin = user.role === 'admin' || user.role === 'super_admin';

    const { data: portalUsers, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('*, Shop(id, name, location)')
      .eq('userId', payload.userId);

    const portalUser = portalUsers && portalUsers.length > 0 ? portalUsers[0] : null;

    if (!isAdmin && (portalError || !portalUser)) {
      return jsonResponse({
        success: false,
        error: 'Portal user not found',
        code: 'NOT_FOUND'
      }, 404);
    }

    // Build all shop assignments for multi-shop users
    const allShops = (portalUsers || []).map((pu: Record<string, unknown>) => {
      const shop = pu.Shop as Record<string, unknown> | null;
      return shop ? { id: shop.id, name: shop.name, location: shop.location } : null;
    }).filter(Boolean);

    logger.info('Mobile profile retrieved', {
      userId: payload.userId,
      shopCount: allShops.length,
      isAdmin,
      endpoint: '/api/mobile/profile'
    });

    return jsonResponse({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          organizationId: user.organizationId ?? null,
          organization,
          shop: portalUser?.Shop ? {
            id: portalUser.Shop.id,
            name: portalUser.Shop.name,
            location: portalUser.Shop.location
          } : null,
          shops: allShops.length > 1 ? allShops : undefined
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile profile error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/profile'
    });
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

/**
 * PUT /api/mobile/profile
 * Update user profile
 */
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return jsonResponse({ 
        success: false, 
        error: 'Unauthorized',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid token',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    const { name, phone } = await request.json();

    if (!name && !phone) {
      return jsonResponse({ 
        success: false, 
        error: 'At least one field (name or phone) is required',
        code: 'VALIDATION_ERROR'
      }, 400);
    }

    // Update user
    const updateData: Record<string, string | null> = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('User')
      .update(updateData)
      .eq('id', payload.userId)
      .select('id, name, email, phone, role')
      .single();

    if (updateError || !updatedUser) {
      logger.error('Mobile profile update error', { 
        userId: payload.userId,
        error: updateError?.message,
        endpoint: '/api/mobile/profile'
      });
      return jsonResponse({ 
        success: false, 
        error: 'Failed to update profile',
        code: 'INTERNAL_ERROR'
      }, 500);
    }

    logger.info('Mobile profile updated', { 
      userId: payload.userId,
      fields: Object.keys(updateData),
      endpoint: '/api/mobile/profile'
    });

    return jsonResponse({
      success: true,
      data: {
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          role: updatedUser.role
        }
      },
      message: 'Profile updated successfully'
    }, 200);

  } catch (error) {
    logger.error('Mobile profile update error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/profile'
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
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

