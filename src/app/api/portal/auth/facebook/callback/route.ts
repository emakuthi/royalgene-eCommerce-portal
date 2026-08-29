import { NextRequest, NextResponse } from 'next/server';
import { exchangeFacebookAuthCode, verifyFacebookAccessToken } from '@/lib/facebook-auth.server';
import { findOrProvisionUserForSocialIdentity } from '@/lib/social-auth-provision.server';
import { buildPortalAuthResponse } from '@/lib/portal-auth-response.server';
import { consumeOAuthState, clearOAuthState } from '@/lib/oauth-state.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';
import { getOrgUrlFor } from '@/lib/urls';
import logger from '@/lib/logger';

/**
 * GET /api/portal/auth/facebook/callback — see google/callback/route.ts for
 * the overall shape (state validation, provisioning, session-bridge
 * handoff). Facebook's code exchange doesn't return an ID token the way
 * Google's does, so it's a separate hop: exchange code -> access token,
 * then verify that access token the same way the mobile app's flow does.
 */
export async function GET(request: NextRequest) {
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
    clearOAuthState(res);
    return res;
  };

  const stateParam = request.nextUrl.searchParams.get('state');
  const { valid, hostOrgId } = consumeOAuthState(request, stateParam);
  if (!valid) return fail('facebook_state_mismatch');

  const code = request.nextUrl.searchParams.get('code');
  if (!code) return fail('facebook_signin_failed');

  const redirectUri = new URL('/api/portal/auth/facebook/callback', request.url).toString();
  const accessToken = await exchangeFacebookAuthCode(code, redirectUri);
  if (!accessToken) return fail('facebook_signin_failed');

  const identity = await verifyFacebookAccessToken(accessToken);
  if (!identity) return fail('facebook_signin_failed');

  let userId: string;
  let isNewUser: boolean;
  try {
    const provisioned = await findOrProvisionUserForSocialIdentity({ email: identity.email, name: identity.name, provider: 'facebook' }, hostOrgId);
    userId = provisioned.userId;
    isNewUser = provisioned.isNewUser;
  } catch (err) {
    logger.error('Facebook web sign-in: provisioning failed', { error: err instanceof Error ? err.message : String(err) });
    return fail('facebook_signin_failed');
  }

  const result = await buildPortalAuthResponse(userId);
  if (!result.ok) return fail('facebook_signin_failed');
  if (!result.data.organization) return fail('facebook_signin_failed');

  void trackActivity({
    userId,
    userEmail: identity.email,
    userRole: result.data.user.role,
    action: isNewUser ? 'auth.signup' : 'auth.login',
    category: 'auth',
    source: 'portal',
    endpoint: '/api/portal/auth/facebook/callback',
    httpMethod: 'GET',
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get('user-agent'),
    deviceType: detectDeviceType(request.headers.get('user-agent')),
    status: 'success',
    details: { provider: 'facebook', isNewUser },
  });

  const params = new URLSearchParams({ token: result.data.token, name: result.data.user.name || '' });
  const res = NextResponse.redirect(getOrgUrlFor(result.data.organization, `/session-bridge?${params.toString()}`));
  clearOAuthState(res);
  return res;
}
