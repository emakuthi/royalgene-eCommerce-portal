import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyFacebookAccessToken, exchangeFacebookAuthCode, getFacebookNativeRedirectUri } from '@/lib/facebook-auth.server';
import { findOrProvisionUserForSocialIdentity } from '@/lib/social-auth-provision.server';
import { buildMobileAuthResponse } from '@/lib/mobile-auth-response.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';
import logger from '@/lib/logger';

/**
 * POST /api/mobile/auth/facebook
 * Body: { code: string } — an authorization code obtained client-side via
 * the browser-redirect OAuth flow (response_type=code, no native Facebook
 * SDK dependency on the mobile side). Deliberately NOT a raw access token:
 * that would sit in the redirect URI's fragment where any other app
 * registering the same fb<APP_ID>:// custom scheme could potentially
 * observe it. A code is single-use and short-lived, and only this server
 * (holding FACEBOOK_APP_SECRET) can redeem it.
 *
 * Same shape and provisioning logic as POST /api/mobile/auth/google —
 * see that route and social-auth-provision.server.ts for the shared
 * find-or-create-tenant behavior.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (!code) {
      return jsonResponse({ success: false, error: 'code is required', code: 'VALIDATION_ERROR' }, 400);
    }

    const accessToken = await exchangeFacebookAuthCode(code, getFacebookNativeRedirectUri());
    if (!accessToken) {
      return jsonResponse(
        { success: false, error: 'Facebook sign-in is not available right now, or the code could not be exchanged', code: 'FACEBOOK_SIGNIN_FAILED' },
        401,
      );
    }

    const identity = await verifyFacebookAccessToken(accessToken);
    if (!identity) {
      return jsonResponse(
        { success: false, error: 'Facebook sign-in is not available right now, or the token could not be verified', code: 'FACEBOOK_SIGNIN_FAILED' },
        401,
      );
    }

    const hostOrgId = request.headers.get('x-org-id');
    let userId: string;
    let isNewUser: boolean;
    try {
      const provisioned = await findOrProvisionUserForSocialIdentity(
        { email: identity.email, name: identity.name, provider: 'facebook' },
        hostOrgId,
      );
      userId = provisioned.userId;
      isNewUser = provisioned.isNewUser;
    } catch (err) {
      logger.error('Facebook sign-in: provisioning failed', { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ success: false, error: 'Failed to set up your account', code: 'INTERNAL_ERROR' }, 500);
    }

    const result = await buildMobileAuthResponse(userId);
    if (!result.ok) {
      return jsonResponse({ success: false, error: result.error, code: 'FORBIDDEN' }, 403);
    }

    void trackActivity({
      userId,
      userEmail: identity.email,
      userRole: result.data.user.role,
      action: isNewUser ? 'auth.signup' : 'auth.login',
      category: 'auth',
      source: 'mobile',
      endpoint: '/api/mobile/auth/facebook',
      httpMethod: 'POST',
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent')),
      status: 'success',
      details: { provider: 'facebook', isNewUser },
    });

    return jsonResponse(
      { success: true, data: result.data, message: isNewUser ? 'Workspace created' : 'Login successful' },
      isNewUser ? 201 : 200,
    );
  } catch (error) {
    logger.error('Facebook sign-in error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
