import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

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
