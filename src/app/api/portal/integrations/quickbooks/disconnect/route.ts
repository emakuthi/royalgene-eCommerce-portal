import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { disconnectQuickBooks } from '@/lib/integrations/quickbooks-connection.server';

// POST /api/portal/integrations/quickbooks/disconnect — org admin only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  try {
    await disconnectQuickBooks(auth.organizationId);
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to disconnect QuickBooks' }, 500);
  }

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
