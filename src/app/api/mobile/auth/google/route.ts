import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyGoogleIdToken } from '@/lib/google-auth.server';
import { findOrProvisionUserForSocialIdentity } from '@/lib/social-auth-provision.server';
import { buildMobileAuthResponse } from '@/lib/mobile-auth-response.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';
import logger from '@/lib/logger';

/**
 * POST /api/mobile/auth/google
 * Body: { idToken: string } — a Google-issued ID token obtained client-side
 * (GoogleSignInHelper.getSignInIntent(), NOT anything Supabase-related).
 *
 * Verifies the token directly against Google, then either signs the caller
 * in (an existing User with that email) or auto-provisions a brand-new
 * tenant for them — same response shape as POST /api/mobile/auth/login,
 * so the client's existing session-handling code works unchanged.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === 'string' ? body.idToken : undefined;
    if (!idToken) {
      return jsonResponse({ success: false, error: 'idToken is required', code: 'VALIDATION_ERROR' }, 400);
    }

    const identity = await verifyGoogleIdToken(idToken);
    if (!identity) {
      return jsonResponse(
        { success: false, error: 'Google sign-in is not available right now, or the token could not be verified', code: 'GOOGLE_SIGNIN_FAILED' },
        401,
      );
    }
    if (!identity.emailVerified) {
      return jsonResponse({ success: false, error: 'Your Google account email is not verified', code: 'EMAIL_NOT_VERIFIED' }, 401);
    }

    const hostOrgId = request.headers.get('x-org-id');
    let userId: string;
    let isNewUser: boolean;
    try {
      const provisioned = await findOrProvisionUserForSocialIdentity(
        { email: identity.email, name: identity.name, provider: 'google' },
        hostOrgId,
      );
      userId = provisioned.userId;
      isNewUser = provisioned.isNewUser;
    } catch (err) {
      logger.error('Google sign-in: provisioning failed', { error: err instanceof Error ? err.message : String(err) });
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
      endpoint: '/api/mobile/auth/google',
      httpMethod: 'POST',
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent')),
      status: 'success',
      details: { provider: 'google', isNewUser },
    });

    return jsonResponse(
      { success: true, data: result.data, message: isNewUser ? 'Workspace created' : 'Login successful' },
      isNewUser ? 201 : 200,
    );
  } catch (error) {
    logger.error('Google sign-in error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
