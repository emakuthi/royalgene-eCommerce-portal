import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { disconnectDrive } from '@/lib/receipts/drive-connection.server';

// POST /api/portal/integrations/google-drive/disconnect — stops saving receipts to Drive.
// Files already there stay in the owner's Drive; RoyalTrack just can't open them until reconnected.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  await disconnectDrive(auth.organizationId);
  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
