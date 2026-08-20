import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabase-client';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';

// GET /api/portal/tax-profile — the caller's own org's KRA PIN, any authenticated org member.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const { data } = await supabaseAdmin.from('Organization').select('kraPin').eq('id', auth.organizationId).maybeSingle();
  return jsonResponse({ success: true, data: { kraPin: data?.kraPin ?? null } });
}

// PATCH /api/portal/tax-profile — { kraPin }, org admin only.
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const featureResponse = await assertFeatureEnabled(auth.organizationId, FeatureCode.ETIMS_INTEGRATION);
  if (featureResponse) return featureResponse;

  const { kraPin } = await request.json();
  if (!kraPin || typeof kraPin !== 'string' || kraPin.trim().length < 5) {
    return jsonResponse({ success: false, error: 'A valid KRA PIN is required' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ kraPin: kraPin.trim().toUpperCase(), updatedAt: new Date().toISOString() })
    .eq('id', auth.organizationId);

  if (error) return jsonResponse({ success: false, error: error.message }, 500);
  return jsonResponse({ success: true, data: { kraPin: kraPin.trim().toUpperCase() } });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,OPTIONS');
}
