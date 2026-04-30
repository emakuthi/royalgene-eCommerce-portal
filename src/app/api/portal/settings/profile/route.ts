import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
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

    const { name, phone } = await request.json();

    if (!name) {
      return jsonResponse({ success: false, error: 'Name is required' }, 400);
    }

    const { data: updatedUser, error } = await supabaseAdmin
      .from('User')
      .update({
        name,
        phone: phone || null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', payload.userId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return jsonResponse({ success: true, data: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, phone: updatedUser.phone } }, 200);
  } catch (error) {
    console.error('Profile update error:', error);
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('PUT,OPTIONS');
}
