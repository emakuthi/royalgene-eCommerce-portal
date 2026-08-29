import { NextRequest, NextResponse } from 'next/server';
import { exchangeGoogleAuthCode } from '@/lib/google-auth.server';
import { findOrProvisionUserForSocialIdentity } from '@/lib/social-auth-provision.server';
import { buildPortalAuthResponse } from '@/lib/portal-auth-response.server';
import { consumeOAuthState, clearOAuthState } from '@/lib/oauth-state.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';
import { getOrgUrlFor } from '@/lib/urls';
import logger from '@/lib/logger';

/**
 * GET /api/portal/auth/google/callback — Google redirects here after the
 * user consents. Verifies the CSRF state cookie, exchanges the code,
 * finds-or-provisions the tenant, then hands the browser off to
 * /session-bridge on the resolved tenant's own subdomain (same handoff
 * signup already uses) so the token lands in that subdomain's localStorage.
 */
export async function GET(request: NextRequest) {
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
    clearOAuthState(res);
    return res;
  };

  const stateParam = request.nextUrl.searchParams.get('state');
  const { valid, hostOrgId } = consumeOAuthState(request, stateParam);
  if (!valid) return fail('google_state_mismatch');

  const code = request.nextUrl.searchParams.get('code');
  if (!code) return fail('google_signin_failed');

  const redirectUri = new URL('/api/portal/auth/google/callback', request.url).toString();
  const identity = await exchangeGoogleAuthCode(code, redirectUri);
  if (!identity) return fail('google_signin_failed');
  if (!identity.emailVerified) return fail('google_email_not_verified');

  let userId: string;
  let isNewUser: boolean;
  try {
    const provisioned = await findOrProvisionUserForSocialIdentity({ email: identity.email, name: identity.name, provider: 'google' }, hostOrgId);
    userId = provisioned.userId;
    isNewUser = provisioned.isNewUser;
  } catch (err) {
    logger.error('Google web sign-in: provisioning failed', { error: err instanceof Error ? err.message : String(err) });
    return fail('google_signin_failed');
  }

  const result = await buildPortalAuthResponse(userId);
  if (!result.ok) return fail('google_signin_failed');
  if (!result.data.organization) return fail('google_signin_failed');

  void trackActivity({
    userId,
    userEmail: identity.email,
    userRole: result.data.user.role,
    action: isNewUser ? 'auth.signup' : 'auth.login',
    category: 'auth',
    source: 'portal',
    endpoint: '/api/portal/auth/google/callback',
    httpMethod: 'GET',
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get('user-agent'),
    deviceType: detectDeviceType(request.headers.get('user-agent')),
    status: 'success',
    details: { provider: 'google', isNewUser },
  });

  const params = new URLSearchParams({ token: result.data.token, name: result.data.user.name || '' });
  const res = NextResponse.redirect(getOrgUrlFor(result.data.organization, `/session-bridge?${params.toString()}`));
  clearOAuthState(res);
  return res;
}
