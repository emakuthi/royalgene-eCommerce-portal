import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { generateDue } from '@/lib/recurring-expenses.server';

// POST /api/portal/recurring-expenses/run — materialise this tenant's due
// templates immediately (the daily cron does this automatically; this is the
// manual "catch up now" button). Scoped to the caller's own org.
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const result = await generateDue(auth.organizationId);
  return jsonResponse({ success: true, data: result });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
