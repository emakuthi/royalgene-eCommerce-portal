import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { driveAuthUrl, isDriveConfigured } from '@/lib/google-drive.server';
import { signOAuthState } from '@/lib/accounting/oauth-state.server';
import { driveCallbackUrl } from '@/lib/receipts/drive-oauth-urls.server';

// GET /api/portal/integrations/google-drive/connect — Google's consent URL for the owner to
// give RoyalTrack its own receipts folder in their Drive. The client does the redirect
// (Bearer auth isn't carried by a browser navigation), like QuickBooks and Paystack.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  if (!isDriveConfigured()) {
    return jsonResponse({ success: false, error: 'Google Drive is not set up on this platform yet. Contact your platform administrator.' }, 503);
  }
  const authorizationUrl = driveAuthUrl(driveCallbackUrl(), signOAuthState(auth.organizationId, auth.userId));
  return jsonResponse({ success: true, data: { authorizationUrl } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
