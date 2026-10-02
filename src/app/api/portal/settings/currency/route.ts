import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser, requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getOrgCurrency, updateOrgCurrency } from '@/lib/currency.server';

// GET /api/portal/settings/currency — the tenant's base currency + manual USD rate.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }
  const data = await getOrgCurrency(auth.organizationId);
  return jsonResponse({ success: true, data });
}

// PUT /api/portal/settings/currency — { currency?: string, usdRate?: number|null }. Admin only.
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const patch: { currency?: string; usdRate?: number | null } = {};
  if (body.currency !== undefined) {
    if (typeof body.currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.currency.trim())) {
      return jsonResponse({ success: false, error: 'currency must be a 3-letter ISO code' }, 400);
    }
    patch.currency = body.currency.trim();
  }
  if (body.usdRate !== undefined) {
    if (body.usdRate === null) {
      patch.usdRate = null;
    } else {
      const n = Number(body.usdRate);
      if (!Number.isFinite(n) || n <= 0) {
        return jsonResponse({ success: false, error: 'usdRate must be a positive number or null' }, 400);
      }
      patch.usdRate = n;
    }
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ success: false, error: 'Nothing to update' }, 400);
  }

  try {
    const data = await updateOrgCurrency(auth.organizationId, patch);
    return jsonResponse({ success: true, data });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Update failed' }, 400);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
