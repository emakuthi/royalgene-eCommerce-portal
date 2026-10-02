import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser, requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabase-client';
import { getCurrencies } from '@/lib/exchange-rates.server';

const CODE_RE = /^[A-Za-z]{3}$/;

// GET /api/currencies — the global currency reference list (any authed user).
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return jsonResponse({ success: true, data: await getCurrencies() });
}

// POST /api/currencies — add a currency (super_admin). Reference data is global.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) return jsonResponse({ success: false, error: 'code must be a 3-letter ISO code' }, 400);
  if (typeof body.name !== 'string' || !body.name.trim()) return jsonResponse({ success: false, error: 'name is required' }, 400);
  const decimals = body.decimals === undefined ? 2 : Number(body.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return jsonResponse({ success: false, error: 'decimals must be 0–6' }, 400);

  const { data, error } = await supabaseAdmin
    .from('Currency')
    .upsert([{
      code,
      name: String(body.name).trim(),
      symbol: typeof body.symbol === 'string' && body.symbol.trim() ? body.symbol.trim() : code,
      decimals,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    }], { onConflict: 'code' })
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ success: false, error: error.message }, 400);
  return jsonResponse({ success: true, data });
}

// PATCH /api/currencies — { code, isActive?, name?, symbol?, decimals? } (super_admin).
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) return jsonResponse({ success: false, error: 'code must be a 3-letter ISO code' }, 400);

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.symbol === 'string' && body.symbol.trim()) patch.symbol = body.symbol.trim();
  if (body.decimals !== undefined) {
    const d = Number(body.decimals);
    if (!Number.isInteger(d) || d < 0 || d > 6) return jsonResponse({ success: false, error: 'decimals must be 0–6' }, 400);
    patch.decimals = d;
  }

  const { data, error } = await supabaseAdmin.from('Currency').update(patch).eq('code', code).select('*').maybeSingle();
  if (error) return jsonResponse({ success: false, error: error.message }, 400);
  if (!data) return jsonResponse({ success: false, error: 'Currency not found' }, 404);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,PATCH,OPTIONS');
}
