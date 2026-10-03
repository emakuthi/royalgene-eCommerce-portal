import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getActiveCurrencies } from '@/lib/exchange-rates.server';

// GET /api/mobile/currencies/active — active currencies for the app (mobile token).
// The Android client's base URL is .../api/mobile/, so it needs this under that
// prefix (the portal uses /api/currencies/active).
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  return jsonResponse({ success: true, data: await getActiveCurrencies() });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
