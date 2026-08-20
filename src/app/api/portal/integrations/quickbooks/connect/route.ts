import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { getAuthorizationUrl, isQuickBooksConfigured } from '@/lib/accounting/quickbooks.server';
import { signOAuthState } from '@/lib/accounting/oauth-state.server';

// GET /api/portal/integrations/quickbooks/connect — returns the Intuit consent URL; the
// client does the actual redirect (this app's auth is Bearer-header-only, so a plain
// browser navigation here wouldn't carry the token — same pattern as Paystack checkout).
export async function GET(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  if (!isQuickBooksConfigured()) {
    return jsonResponse({ success: false, error: 'QuickBooks is not configured yet. Contact your platform administrator.' }, 503);
  }

  const featureResponse = await assertFeatureEnabled(auth.organizationId, FeatureCode.ACCOUNTING_INTEGRATION);
  if (featureResponse) return featureResponse;

  const redirectUri = `${request.nextUrl.origin}/api/portal/integrations/quickbooks/callback`;
  const state = signOAuthState(auth.organizationId, auth.userId);
  const authorizationUrl = getAuthorizationUrl(redirectUri, state);

  if (!authorizationUrl) {
    return jsonResponse({ success: false, error: 'QuickBooks is not configured yet. Contact your platform administrator.' }, 503);
  }

  return jsonResponse({ success: true, data: { authorizationUrl } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
