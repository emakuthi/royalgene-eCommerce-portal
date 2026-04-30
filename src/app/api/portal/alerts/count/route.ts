import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function GET() {
  try {
    const { count, error } = await supabaseAdmin
      .from('Alert')
      .select('*', { count: 'exact' });

    if (error) return jsonResponse({ success: false, message: String(error) }, 500);

    return jsonResponse({ success: true, count: typeof count === 'number' ? count : 0 }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
