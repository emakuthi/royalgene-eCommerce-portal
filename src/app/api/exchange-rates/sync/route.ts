import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { syncExchangeRates } from '@/lib/exchange-rates.server';

// POST /api/exchange-rates/sync — manual "Sync Now" (admin). Pulls latest global
// rates from ExchangeRate-API. Never touches tenant overrides.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  const result = await syncExchangeRates();
  if (!result.ok) {
    // Reliability: a failed sync must not look like success, but also must not
    // 500 the UI — surface the reason; existing rates remain usable.
    return jsonResponse({ success: false, error: result.error || 'Sync failed', data: result }, 502);
  }
  return jsonResponse({ success: true, data: result });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
