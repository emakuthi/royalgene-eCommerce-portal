import { NextRequest } from 'next/server';
import { verifyToken, hashPassword, comparePasswords } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * PUT /api/mobile/settings/password
 * Change the authenticated user's password
 */
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return jsonResponse({
        success: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({
        success: false,
        error: 'Invalid token',
        code: 'UNAUTHORIZED',
      }, 401);
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return jsonResponse({
        success: false,
        error: 'Current password and new password are required',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    if (newPassword.length < 8) {
      return jsonResponse({
        success: false,
        error: 'New password must be at least 8 characters',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('id', payload.userId)
      .single();

    if (userError || !user) {
      return jsonResponse({
        success: false,
        error: 'User not found',
        code: 'NOT_FOUND',
      }, 404);
    }

    // Verify current password
    const passwordMatch = await comparePasswords(currentPassword, user.password);
    if (!passwordMatch) {
      return jsonResponse({
        success: false,
        error: 'Current password is incorrect',
        code: 'INVALID_PASSWORD',
      }, 401);
    }

    // Hash and update new password
    const hashedPassword = await hashPassword(newPassword);
    const { error: updateError } = await supabaseAdmin
      .from('User')
      .update({
        password: hashedPassword,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', payload.userId);

    if (updateError) {
      logger.error('Mobile password change failed', {
        userId: payload.userId,
        error: updateError.message,
        endpoint: '/api/mobile/settings/password',
      });
      return jsonResponse({
        success: false,
        error: 'Failed to update password',
        code: 'INTERNAL_ERROR',
      }, 500);
    }

    logger.info('Mobile password changed successfully', {
      userId: payload.userId,
      endpoint: '/api/mobile/settings/password',
    });

    return jsonResponse({
      success: true,
      message: 'Password changed successfully',
    }, 200);
  } catch (error) {
    logger.error('Mobile password change error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/settings/password',
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
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

