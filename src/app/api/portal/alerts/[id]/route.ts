import { type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Acknowledge (mark read)
  const { id } = await params;
  try {
    const { data, error } = await supabaseAdmin.from('Alert').update({ read: true, updatedAt: new Date().toISOString() }).eq('id', id).select().single();
    if (error) return jsonResponse({ success: false, message: String(error) }, 500);
    return jsonResponse({ success: true, data }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { error } = await supabaseAdmin.from('Alert').delete().eq('id', id);
    if (error) return jsonResponse({ success: false, message: String(error) }, 500);
    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,DELETE,OPTIONS');
}
