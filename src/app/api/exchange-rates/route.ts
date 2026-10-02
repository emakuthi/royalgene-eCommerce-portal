import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser, requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listRates, setManualOverride } from '@/lib/exchange-rates.server';

const CODE_RE = /^[A-Za-z]{3}$/;

// GET /api/exchange-rates — latest global rates + this tenant's overrides.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return jsonResponse({ success: true, data: await listRates(auth.organizationId) });
}

// POST /api/exchange-rates — create a manual override for this tenant (admin).
// Body: { baseCurrency, targetCurrency, rate }
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const base = typeof body.baseCurrency === 'string' ? body.baseCurrency.trim().toUpperCase() : '';
  const target = typeof body.targetCurrency === 'string' ? body.targetCurrency.trim().toUpperCase() : '';
  const rate = Number(body.rate);
  if (!CODE_RE.test(base) || !CODE_RE.test(target)) return jsonResponse({ success: false, error: 'Invalid currency code' }, 400);
  if (base === target) return jsonResponse({ success: false, error: 'base and target must differ' }, 400);
  if (!Number.isFinite(rate) || rate <= 0) return jsonResponse({ success: false, error: 'rate must be a positive number' }, 400);

  const data = await setManualOverride(auth.organizationId, base, target, rate, auth.userId);
  if (!data) return jsonResponse({ success: false, error: 'Failed to save override' }, 500);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
