import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Acknowledge (mark read)
  const { id } = await params;
  try {
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin.from('Alert').update({ read: true, updatedAt: new Date().toISOString() }).eq('id', id);
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);
    const { data, error } = await query.select().maybeSingle();

    if (error) return jsonResponse({ success: false, message: String(error) }, 500);
    if (!data) return jsonResponse({ success: false, message: 'Alert not found' }, 404);
    return jsonResponse({ success: true, data }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin.from('Alert').delete().eq('id', id);
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);
    const { error } = await query;

    if (error) return jsonResponse({ success: false, message: String(error) }, 500);
    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,DELETE,OPTIONS');
}
