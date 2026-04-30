import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function POST() {
  try {
    const { error } = await supabaseAdmin.from('Alert').update({ read: true, updatedAt: new Date().toISOString() });
    if (error) return jsonResponse({ success: false, message: String(error) }, 500);
    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
