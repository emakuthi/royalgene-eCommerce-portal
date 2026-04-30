import { NextRequest } from 'next/server';
import { verifyToken, hashPassword, comparePasswords } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return jsonResponse({ success: false, error: 'Current and new passwords required' }, 400);
    }

    if (newPassword.length < 8) {
      return jsonResponse({ success: false, error: 'New password must be at least 8 characters' }, 400);
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('id', payload.userId)
      .single();

    if (userError || !user) {
      return jsonResponse({ success: false, error: 'User not found' }, 404);
    }

    // Verify current password
    const passwordMatch = await comparePasswords(currentPassword, user.password);
    if (!passwordMatch) {
      return jsonResponse({ success: false, error: 'Current password is incorrect' }, 401);
    }

    // Hash and update password
    const hashedPassword = await hashPassword(newPassword);
    const { error: updateError } = await supabaseAdmin
      .from('User')
      .update({
        password: hashedPassword,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', payload.userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return jsonResponse({ success: true, message: 'Password changed successfully' }, 200);
  } catch (error) {
    console.error('Password change error:', error);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PUT,OPTIONS');
}
