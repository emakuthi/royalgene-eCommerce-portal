import { NextRequest } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '@/lib/supabase-client';
import { hashPassword, signAuthToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';
import { createOrganization, isSlugAvailable, isValidSlug, slugify } from '@/lib/organizations.server';
import { RESERVED_SUBDOMAINS } from '@/lib/tenant';
import { sendVerificationEmail } from '@/lib/email/verification-email';
import { getSelfSignupEnabled } from '@/lib/platform-settings.server';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
    if (password.length < 8) {
      return jsonResponse({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }

    const slug = slugify(requestedSlug || orgName);
    if (!slug || !isValidSlug(slug)) {
      return jsonResponse({ success: false, error: 'Could not derive a valid workspace URL from that name — please pick a different one' }, 400);
    }
    if (RESERVED_SUBDOMAINS.includes(slug)) {
      return jsonResponse({ success: false, error: 'That workspace URL is reserved — please pick a different one' }, 400);
    }
    if (!(await isSlugAvailable(slug))) {
      return jsonResponse({ success: false, error: 'That workspace URL is already taken' }, 409);
    }

    const normalizedEmail = email.toLowerCase();

    let organization;
    try {
      organization = await createOrganization({ name: orgName, slug });
    } catch (err) {
      logger.error('Signup: organization creation failed', { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ success: false, error: 'Failed to create organization' }, 500);
    }

    const now = new Date().toISOString();
    const userId = uuidv4();
    const hashedPassword = await hashPassword(password);

    const { error: userError } = await supabaseAdmin.from('User').insert([{
      id: userId,
      email: normalizedEmail,
      password: hashedPassword,
      name,
      role: 'admin',
      twoFactorEnabled: false,
      organizationId: organization.id,
      createdAt: now,
      updatedAt: now,
    }]);
    if (userError) {
      await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
      logger.error('Signup: user creation failed', { error: userError.message });
      return jsonResponse({ success: false, error: 'Failed to create account' }, 500);
    }

    // Default shop so existing shop/role-gated routes have something to attach to.
    const shopId = uuidv4();
    const { error: shopError } = await supabaseAdmin.from('Shop').insert([{
      id: shopId,
      name: orgName,
      location: 'Main',
      isActive: true,
      organizationId: organization.id,
      createdAt: now,
      updatedAt: now,
    }]);
    if (shopError) {
      await supabaseAdmin.from('User').delete().eq('id', userId);
      await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
      logger.error('Signup: default shop creation failed', { error: shopError.message });
      return jsonResponse({ success: false, error: 'Failed to set up workspace' }, 500);
    }

    const portalUserId = uuidv4();
    const { error: portalUserError } = await supabaseAdmin.from('PortalUser').insert([{
      id: portalUserId,
      userId,
      shopId,
      position: 'shop_owner',
      isActive: true,
      mobileAccess: true,
      organizationId: organization.id,
      createdAt: now,
      updatedAt: now,
    }]);
    if (portalUserError) {
      await supabaseAdmin.from('Shop').delete().eq('id', shopId);
      await supabaseAdmin.from('User').delete().eq('id', userId);
      await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
      logger.error('Signup: portal user creation failed', { error: portalUserError.message });
      return jsonResponse({ success: false, error: 'Failed to set up workspace' }, 500);
    }

    // Email verification token — store only the hash.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();

    await supabaseAdmin.from('EmailVerificationToken').insert([{
      id: uuidv4(),
      userId,
      organizationId: organization.id,
      tokenHash,
      expiresAt,
      createdAt: now,
    }]);

    const emailResult = await sendVerificationEmail({
      to: normalizedEmail,
      name,
      orgName,
      orgSlug: slug,
      token: rawToken,
    });
    if (!emailResult.ok) {
      logger.warn('Signup: verification email failed to send', { error: emailResult.error, userId });
    }

    const token = signAuthToken({
      userId,
      organizationId: organization.id,
      email: normalizedEmail,
      role: 'admin',
      shopId,
    });

    logger.info('Signup successful', {
      userId, organizationId: organization.id, slug,
      duration: Date.now() - startTime,
    });

    return jsonResponse({
      success: true,
      data: {
        token,
        user: { id: userId, email: normalizedEmail, name, role: 'admin', emailVerified: false },
        organization: { id: organization.id, name: organization.name, slug: organization.slug, status: organization.status },
        shop: { id: shopId, name: orgName },
      },
    }, 201);
  } catch (error) {
    logger.error('Signup error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
