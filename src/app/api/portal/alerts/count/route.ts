import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin.from('Alert').select('*', { count: 'exact' });
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);
    const { count, error } = await query;

    if (error) return jsonResponse({ success: false, message: String(error) }, 500);

    return jsonResponse({ success: true, count: typeof count === 'number' ? count : 0 }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
