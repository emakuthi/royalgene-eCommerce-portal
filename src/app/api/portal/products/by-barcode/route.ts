import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { normalizeBarcode, resolveBarcode } from '@/lib/barcode.server';
import logger from '@/lib/logger';

// GET /api/portal/products/by-barcode?code=…&shopId=…
// Resolves a scanned code to the product, this shop's stock row and (when the code
// pins one) the size/colour cell. A code that matches nothing returns 200 with
// found:false so the UI can offer "add this product" instead of treating it as an error.
export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    if (!auth.organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required' }, 400);
    }

    const { searchParams } = new URL(request.url);
    const code = normalizeBarcode(searchParams.get('code'));
    const shopId = searchParams.get('shopId');
    if (!code) return jsonResponse({ success: false, error: 'code is required' }, 400);
    if (!shopId) return jsonResponse({ success: false, error: 'shopId is required' }, 400);

    // The shop must belong to the caller's own organization.
    const { data: shop } = await supabaseAdmin
      .from('Shop')
      .select('id')
      .eq('id', shopId)
      .eq('organizationId', auth.organizationId)
      .maybeSingle();
    if (!shop) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

    const result = await resolveBarcode({ organizationId: auth.organizationId, shopId, code });
    return jsonResponse({ success: true, data: result }, 200);
  } catch (err) {
    logger.error('Barcode lookup failed', {
      error: err instanceof Error ? err.message : String(err),
      endpoint: '/api/portal/products/by-barcode',
    });
    return jsonResponse({ success: false, error: 'Barcode lookup failed' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
