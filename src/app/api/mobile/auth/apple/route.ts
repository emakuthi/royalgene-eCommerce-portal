import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyAppleIdentityToken } from '@/lib/apple-auth.server';
import { findOrProvisionUserForAppleIdentity } from '@/lib/social-auth-provision.server';
import { buildMobileAuthResponse } from '@/lib/mobile-auth-response.server';
import { deviceInfoFromBody } from '@/lib/device-registry.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';
import logger from '@/lib/logger';

/**
 * POST /api/mobile/auth/apple
 * Body: { identityToken: string, nonce: string, name?: string }
 *
 * Same response shape as POST /api/mobile/auth/google. `nonce` is the raw value
 * whose SHA-256 the app gave Apple. `name` comes from the app because Apple only
 * tells it the person's name, and only the first time; it's used only to name a
 * new account.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const identityToken = typeof body?.identityToken === 'string' ? body.identityToken : undefined;
    const nonce = typeof body?.nonce === 'string' ? body.nonce : undefined;
    if (!identityToken || !nonce) {
      return jsonResponse({ success: false, error: 'identityToken and nonce are required', code: 'VALIDATION_ERROR' }, 400);
    }

    const identity = await verifyAppleIdentityToken(identityToken, nonce);
    if (!identity) {
      return jsonResponse(
        { success: false, error: "Apple sign-in couldn't be verified. Please try again.", code: 'APPLE_SIGNIN_FAILED' },
        401,
      );
    }

    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    let provisioned: { userId: string; isNewUser: boolean } | null;
    try {
      provisioned = await findOrProvisionUserForAppleIdentity({ subject: identity.subject, email: identity.email, name: name || null });
    } catch (err) {
      logger.error('Apple sign-in: provisioning failed', { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ success: false, error: 'Failed to set up your account', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!provisioned) {
      return jsonResponse(
        {
          success: false,
          error: "Apple didn't share your email. In your iPhone's Settings, stop using Sign in with Apple for RoyalTrack, then try again.",
          code: 'APPLE_EMAIL_MISSING',
        },
        401,
      );
    }
    const { userId, isNewUser } = provisioned;

    const device = deviceInfoFromBody(body);
    const result = await buildMobileAuthResponse(userId, device);
    if (!result.ok) {
      return jsonResponse({ success: false, error: result.error, code: 'FORBIDDEN' }, 403);
    }

    void trackActivity({
      userId,
      userEmail: result.data.user.email,
      userRole: result.data.user.role,
      organizationId: result.data.organization?.id ?? null,
      action: isNewUser ? 'auth.signup' : 'auth.login',
      category: 'auth',
      source: 'mobile',
      endpoint: '/api/mobile/auth/apple',
      httpMethod: 'POST',
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent'), 'mobile'),
      status: 'success',
      details: { provider: 'apple', isNewUser, ...(device ? { deviceName: device.deviceName, platform: device.platform } : {}) },
    });

    return jsonResponse(
      { success: true, data: { ...result.data, isNewUser }, message: isNewUser ? 'Workspace created' : 'Login successful' },
      isNewUser ? 201 : 200,
    );
  } catch (error) {
    logger.error('Apple sign-in error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
