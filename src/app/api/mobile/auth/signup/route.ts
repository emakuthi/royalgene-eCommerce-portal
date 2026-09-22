import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';
import { getSelfSignupEnabled } from '@/lib/platform-settings.server';
import { provisionWorkspace, SignupError } from '@/lib/signup.server';
import { deviceInfoFromBody } from '@/lib/device-registry.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';

/**
 * POST /api/mobile/auth/signup
 * Create a brand-new workspace from the app: an Organization, its first admin
 * User (email + password), a default Shop and shop_owner PortalUser. Returns
 * the same { token, user, organization, shop } block as /auth/login so the app
 * can sign the user straight in. Email verification is kicked off in the
 * background — it doesn't gate use.
 *
 * Body: { orgName, name, email, password, slug? }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    if (!(await getSelfSignupEnabled())) {
      return jsonResponse({ success: false, error: 'Self-service signup is currently disabled. Contact us to get set up.', code: 'SIGNUP_DISABLED' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const { orgName, name, email, password, slug } = body as {
      orgName?: string; name?: string; email?: string; password?: string; slug?: string;
    };

    if (!orgName || !name || !email || !password) {
      return jsonResponse({ success: false, error: 'orgName, name, email and password are required', code: 'VALIDATION_ERROR' }, 400);
    }

    const device = deviceInfoFromBody(body as Record<string, unknown>);
    const result = await provisionWorkspace({ orgName, name, email, password, requestedSlug: slug, device });

    void trackActivity({
      userId: result.userId,
      userEmail: result.normalizedEmail,
      userRole: 'admin',
      action: 'auth.signup',
      category: 'auth',
      source: 'mobile',
      endpoint: '/api/mobile/auth/signup',
      httpMethod: 'POST',
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent'), 'mobile'),
      status: 'success',
      details: { organizationId: result.organization.id, slug: result.organization.slug },
    });

    logger.info('Mobile signup successful', {
      userId: result.userId, organizationId: result.organization.id, slug: result.organization.slug,
      duration: Date.now() - startTime,
    });

    const shop = { id: result.shopId, name: orgName, location: 'Main', phoneNumber: null, address: null };

    return jsonResponse({
      success: true,
      data: {
        token: result.token,
        user: {
          id: result.userId,
          email: result.normalizedEmail,
          name,
          phone: null,
          role: 'admin',
          organizationId: result.organization.id,
        },
        organization: result.organization,
        shop,
        // Return the one shop that provisioning just created (not []), so a
        // client can show it immediately without waiting on GET /api/mobile/shops.
        shops: [shop],
      },
    }, 201);
  } catch (error) {
    if (error instanceof SignupError) {
      return jsonResponse({ success: false, error: error.message, code: 'SIGNUP_ERROR' }, error.status);
    }
    logger.error('Mobile signup error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
