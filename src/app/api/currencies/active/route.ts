import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getActiveCurrencies } from '@/lib/exchange-rates.server';

// GET /api/currencies/active — active currencies only.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return jsonResponse({ success: true, data: await getActiveCurrencies() });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
