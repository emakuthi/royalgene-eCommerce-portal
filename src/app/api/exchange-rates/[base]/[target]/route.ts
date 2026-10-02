import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getRate } from '@/lib/exchange-rates.server';

const CODE_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/exchange-rates/{base}/{target}[?date=YYYY-MM-DD]
// Resolves the applicable rate (tenant override → global, historical if dated).
export async function GET(request: NextRequest, context: { params: Promise<{ base: string; target: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;

  const { base, target } = await context.params;
  const b = base.toUpperCase();
  const t = target.toUpperCase();
  if (!CODE_RE.test(b) || !CODE_RE.test(t)) return jsonResponse({ success: false, error: 'Invalid currency code' }, 400);

  const date = request.nextUrl.searchParams.get('date') || undefined;
  if (date && !DATE_RE.test(date)) return jsonResponse({ success: false, error: 'date must be YYYY-MM-DD' }, 400);

  const rate = await getRate(b, t, { date, organizationId: auth.organizationId });
  if (rate == null) return jsonResponse({ success: false, error: 'No rate available for this pair' }, 404);
  return jsonResponse({ success: true, data: { baseCurrency: b, targetCurrency: t, rate, date: date || new Date().toISOString().slice(0, 10) } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
