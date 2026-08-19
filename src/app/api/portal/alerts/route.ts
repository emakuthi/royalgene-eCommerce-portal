import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '10') || 10;
    const offset = Number(url.searchParams.get('offset') ?? '0') || 0;

    let query = supabaseAdmin
      .from('Alert')
      .select('*', { count: 'exact' })
      .order('createdAt', { ascending: false })
      .range(offset, offset + limit - 1);
    if (auth.organizationId) query = query.eq('organizationId', auth.organizationId);

    const { data, error, count } = await query;

    if (error) {
      return jsonResponse({ success: false, message: String(error) }, 500);
    }

    return jsonResponse({ success: true, data: data ?? [], total: typeof count === 'number' ? count : (data ? data.length : 0) }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    if (!auth.organizationId) {
      return jsonResponse({ success: false, message: 'An organization context is required' }, 400);
    }

    const body = await req.json();
    const { title, message, level, shopId, portalUserId } = body || {};

    if (!title && !message) {
      return jsonResponse({ success: false, message: 'title or message is required' }, 400);
    }

    // If a shopId is supplied, it must belong to the caller's own organization.
    if (shopId) {
      const { data: shopCheck } = await supabaseAdmin
        .from('Shop')
        .select('id')
        .eq('id', shopId)
        .eq('organizationId', auth.organizationId)
        .maybeSingle();
      if (!shopCheck) return jsonResponse({ success: false, message: 'Forbidden' }, 403);
    }

    const record: Record<string, unknown> = {
      id: uuidv4(),
      organizationId: auth.organizationId,
      title: title ?? null,
      message: message ?? null,
      level: level ?? null,
      read: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (shopId) record.shopId = shopId;
    if (portalUserId) record.portalUserId = portalUserId;

    const { data, error } = await supabaseAdmin.from('Alert').insert([record]).select().single();

    if (error) {
      return jsonResponse({ success: false, message: String(error) }, 500);
    }

    return jsonResponse({ success: true, data }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
