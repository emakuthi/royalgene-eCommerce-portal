import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getRate } from '@/lib/exchange-rates.server';

const CODE_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/mobile/exchange-rates/{base}/{target}[?date=] — rate for the app
// (mobile token), tenant-scoped (override → global). Mirror of the portal route
// under the /api/mobile/ prefix the Android client uses.
export async function GET(request: NextRequest, context: { params: Promise<{ base: string; target: string }> }) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

  const { base, target } = await context.params;
  const b = base.toUpperCase();
  const t = target.toUpperCase();
  if (!CODE_RE.test(b) || !CODE_RE.test(t)) return jsonResponse({ success: false, error: 'Invalid currency code' }, 400);

  const date = request.nextUrl.searchParams.get('date') || undefined;
  if (date && !DATE_RE.test(date)) return jsonResponse({ success: false, error: 'date must be YYYY-MM-DD' }, 400);

  const rate = await getRate(b, t, { date, organizationId: payload.organizationId });
  if (rate == null) return jsonResponse({ success: false, error: 'No rate available for this pair' }, 404);
  return jsonResponse({ success: true, data: { baseCurrency: b, targetCurrency: t, rate, date: date || new Date().toISOString().slice(0, 10) } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
