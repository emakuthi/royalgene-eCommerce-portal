import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';
import { getSelfSignupEnabled } from '@/lib/platform-settings.server';
import { provisionWorkspace, SignupError } from '@/lib/signup.server';

// POST /api/auth/signup — self-serve tenant onboarding.
// Creates an Organization, its first admin User, a default Shop + PortalUser
// so existing shop/role-gated routes work immediately, and kicks off email
// verification. Signs the user in right away (returns a token) rather than
// leaving them on a dead-end "check your inbox" screen.
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    if (!(await getSelfSignupEnabled())) {
      return jsonResponse({ success: false, error: 'Self-service signup is currently disabled. Contact us to get set up.' }, 403);
    }

    const body = await request.json();
    const { orgName, name, email, password } = body as {
      orgName?: string; name?: string; email?: string; password?: string;
    };
    const requestedSlug: string | undefined = body.slug;

    if (!orgName || !name || !email || !password) {
      return jsonResponse({ success: false, error: 'orgName, name, email and password are required' }, 400);
    }

    const result = await provisionWorkspace({ orgName, name, email, password, requestedSlug });

    logger.info('Signup successful', {
      userId: result.userId, organizationId: result.organization.id, slug: result.organization.slug,
      duration: Date.now() - startTime,
    });

    return jsonResponse({
      success: true,
      data: {
        token: result.token,
        user: { id: result.userId, email: result.normalizedEmail, name, role: 'admin', emailVerified: false },
        organization: result.organization,
        shop: { id: result.shopId, name: orgName },
      },
    }, 201);
  } catch (error) {
    if (error instanceof SignupError) {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    logger.error('Signup error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
