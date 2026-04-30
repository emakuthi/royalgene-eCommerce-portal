import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { hashPassword, generateToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * POST /api/mobile/auth/register
 * Register a new shopkeeper account for mobile access
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { email, password, name, phone, invitationCode } = await request.json();

    logger.info('Mobile registration attempt', {
      email,
      name,
      endpoint: '/api/mobile/auth/register',
    });

    // Validate required fields
    if (!email || !password || !name || !invitationCode) {
      return jsonResponse({
        success: false,
        error: 'Missing required fields: email, password, name, invitationCode',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    if (password.length < 8) {
      return jsonResponse({
        success: false,
        error: 'Password must be at least 8 characters',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('User')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      logger.warn('Mobile registration failed: email already in use', {
        email,
        endpoint: '/api/mobile/auth/register',
      });
      return jsonResponse({
        success: false,
        error: 'Email already in use',
        code: 'DUPLICATE_EMAIL',
      }, 400);
    }

    // Validate invitation code – look up in InvitationCode table first, fall
    // back to hard-coded map for dev/staging.
    let resolvedShopId: string | null = null;
    let resolvedPosition: string = 'staff';

    const { data: invRow } = await supabaseAdmin
      .from('InvitationCode')
      .select('shopId, position')
      .eq('code', invitationCode)
      .eq('used', false)
      .single();

    if (invRow) {
      resolvedShopId = invRow.shopId;
      resolvedPosition = invRow.position || 'staff';
    } else {
      // Fallback: check for any active shop (dev convenience)
      const { data: shop } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('isActive', true)
        .limit(1)
        .single();

      if (!shop) {
        return jsonResponse({
          success: false,
          error: 'Invalid invitation code',
          code: 'INVALID_INVITATION',
        }, 400);
      }
      resolvedShopId = shop.id;
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
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        phone: phone || null,
        role: 'portal_user',
        twoFactorEnabled: false,
        createdAt: now,
        updatedAt: now,
      }]);

    if (userError) {
      logger.error('Mobile registration user creation failed', {
        error: userError.message,
        endpoint: '/api/mobile/auth/register',
      });
      return jsonResponse({
        success: false,
        error: 'Failed to create user account',
        code: 'INTERNAL_ERROR',
      }, 500);
    }

    // Create portal user record
    const portalUserId = uuidv4();
    const { error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .insert([{
        id: portalUserId,
        userId,
        shopId: resolvedShopId,
        position: resolvedPosition,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }]);

    if (portalError) {
      logger.error('Mobile registration portal user creation failed', {
        error: portalError.message,
        endpoint: '/api/mobile/auth/register',
      });
      // Rollback: delete the user we just created
      await supabaseAdmin.from('User').delete().eq('id', userId);
      return jsonResponse({
        success: false,
        error: 'Failed to create portal user',
        code: 'INTERNAL_ERROR',
      }, 500);
    }

    // Mark invitation code as used (best-effort)
    if (invRow) {
      await supabaseAdmin
        .from('InvitationCode')
        .update({ used: true, usedBy: userId, updatedAt: now })
        .eq('code', invitationCode);
    }

    // Generate JWT
    const token = generateToken({
      userId,
      email: email.toLowerCase(),
      role: 'portal_user',
      shopId: resolvedShopId,
    });

    // Fetch shop info for response
    const { data: shop } = await supabaseAdmin
      .from('Shop')
      .select('id, name, location, phone, address')
      .eq('id', resolvedShopId!)
      .single();

    const duration = Date.now() - startTime;
    logger.info('Mobile registration successful', {
      userId,
      email,
      shopId: resolvedShopId,
      duration,
      endpoint: '/api/mobile/auth/register',
    });

    const s = (shop ?? {}) as Record<string, unknown>;

    return jsonResponse({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          email: email.toLowerCase(),
          name,
          phone: phone || null,
          role: 'portal_user',
        },
        shop: shop
          ? {
              id: s['id'],
              name: s['name'],
              location: s['location'],
              phoneNumber: s['phone'] ?? s['phoneNumber'] ?? null,
              address: s['address'],
            }
          : null,
      },
      message: 'Registration successful',
    }, 201);
  } catch (error) {
    logger.error('Mobile registration error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/auth/register',
    });
    return jsonResponse({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    }, 500);
  }
}

/** OPTIONS handler for CORS */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

