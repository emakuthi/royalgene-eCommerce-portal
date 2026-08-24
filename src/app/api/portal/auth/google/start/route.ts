import { NextRequest, NextResponse } from 'next/server';
import { DEV_TENANT_SLUG } from '@/lib/tenant';
import { getOrganizationBySlug } from '@/lib/organizations.server';
import { isGoogleWebSignInConfigured } from '@/lib/google-auth.server';
import { issueOAuthState } from '@/lib/oauth-state.server';

/**
 * GET /api/portal/auth/google/start?tenant=<slug>
 *
 * Always linked to as an ABSOLUTE URL pointing at the default tenant's
 * host (see getGoogleStartUrl in src/lib/social-auth-urls.ts) — Google only
 * allows a fixed, pre-registered set of redirect URIs, so this route (and
 * its callback) must always run on that one host regardless of which
 * tenant subdomain the login page itself was on. `tenant` carries that
 * origin subdomain through so the callback can scope the user lookup to
 * the right org, the same way the mobile app's x-org-id header does.
 */
export async function GET(request: NextRequest) {
  if (!isGoogleWebSignInConfigured()) {
    return NextResponse.redirect(new URL('/login?error=google_not_configured', request.url));
  }

  const tenantSlug = request.nextUrl.searchParams.get('tenant') || DEV_TENANT_SLUG;
  const org = await getOrganizationBySlug(tenantSlug);

  const redirectUri = new URL('/api/portal/auth/google/callback', request.url).toString();
  const { nonce, applyTo } = issueOAuthState(org?.id ?? null);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',')[0].trim());
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', nonce);
  authUrl.searchParams.set('prompt', 'select_account');

  const res = NextResponse.redirect(authUrl);
  applyTo(res);
  return res;
}
