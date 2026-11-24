import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { driveAuthUrl, isDriveConfigured } from '@/lib/google-drive.server';
import { signOAuthState } from '@/lib/accounting/oauth-state.server';
import { driveCallbackUrl } from '@/lib/receipts/drive-oauth-urls.server';
import { mobileReceiptsAuth } from '@/lib/receipts/mobile-auth.server';

// GET /api/mobile/receipts/connect — Google's consent URL for the owner to connect Drive from the app.
// The app opens it in the browser; the callback is the portal's, and ends on a "back to the app" page.
export async function GET(request: NextRequest) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'admin' && auth.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the owner can connect Google Drive', code: 'FORBIDDEN' }, 403);
  }
  if (!isDriveConfigured()) {
    return jsonResponse({ success: false, error: 'Google Drive is not set up on this platform yet. Contact support.' }, 503);
  }
  const state = signOAuthState(auth.organizationId as string, auth.userId, { app: true });
  return jsonResponse({ success: true, data: { authorizationUrl: driveAuthUrl(driveCallbackUrl(), state) } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
