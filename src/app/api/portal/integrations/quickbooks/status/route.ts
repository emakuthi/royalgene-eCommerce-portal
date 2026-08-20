import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getQuickBooksConnectionSummary } from '@/lib/integrations/quickbooks-connection.server';
import { isQuickBooksConfigured } from '@/lib/accounting/quickbooks.server';

// GET /api/portal/integrations/quickbooks/status — connection summary, any authenticated org member.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const summary = await getQuickBooksConnectionSummary(auth.organizationId);
  return jsonResponse({ success: true, data: { ...summary, platformConfigured: isQuickBooksConfigured() } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
