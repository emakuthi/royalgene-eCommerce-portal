import { NextRequest, NextResponse } from 'next/server';
import { DEV_TENANT_SLUG } from '@/lib/tenant';
import { getOrganizationBySlug } from '@/lib/organizations.server';
import { isFacebookSignInConfigured } from '@/lib/facebook-auth.server';
import { issueOAuthState } from '@/lib/oauth-state.server';

/**
 * GET /api/portal/auth/facebook/start?tenant=<slug>
 * See google/start/route.ts for why this always runs on the default
 * tenant's fixed host rather than the subdomain the login page was on.
 */
export async function GET(request: NextRequest) {
  if (!isFacebookSignInConfigured()) {
    return NextResponse.redirect(new URL('/login?error=facebook_not_configured', request.url));
  }

  const tenantSlug = request.nextUrl.searchParams.get('tenant') || DEV_TENANT_SLUG;
  const org = await getOrganizationBySlug(tenantSlug);

  const redirectUri = new URL('/api/portal/auth/facebook/callback', request.url).toString();
  const { nonce, applyTo } = issueOAuthState(org?.id ?? null);

  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  authUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID ?? '');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'email,public_profile');
  authUrl.searchParams.set('state', nonce);

  const res = NextResponse.redirect(authUrl);
  applyTo(res);
  return res;
}
