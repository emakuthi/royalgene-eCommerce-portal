import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import { hashPassword, signAuthToken } from './auth.server';
import logger from './logger';
import { createOrganization, isSlugAvailable, isValidSlug, slugify } from './organizations.server';
import { RESERVED_SUBDOMAINS } from './tenant';
import { sendVerificationEmail } from './email/verification-email';
import { isShopNameAvailable } from './shops.server';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Thrown by provisionWorkspace with an HTTP-ready status + message. */
export class SignupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SignupError';
  }
}

export interface ProvisionWorkspaceInput {
  orgName: string;
  name: string;
  email: string;
  password: string;
  /** If omitted, derived from orgName. */
  requestedSlug?: string;
  /** Send the verification email (default true — set false for tests). */
  sendEmail?: boolean;
}

export interface ProvisionWorkspaceResult {
  token: string;
  userId: string;
  normalizedEmail: string;
  organization: { id: string; name: string; slug: string; status: string };
  shopId: string;
}

/**
 * Self-serve tenant onboarding, shared by the web (/api/auth/signup) and
 * mobile (/api/mobile/auth/signup) routes. Creates an Organization, its first
 * admin User, a default Shop + shop_owner PortalUser, kicks off email
 * verification, and returns a signed session token. Rolls back on any failure.
 */
export async function provisionWorkspace(input: ProvisionWorkspaceInput): Promise<ProvisionWorkspaceResult> {
  const { orgName, name, email, password, requestedSlug, sendEmail = true } = input;

  if (!orgName?.trim() || !name?.trim() || !email?.trim() || !password) {
    throw new SignupError(400, 'orgName, name, email and password are required');
  }
  if (password.length < 8) {
    throw new SignupError(400, 'Password must be at least 8 characters');
  }

  const slug = slugify(requestedSlug || orgName);
  if (!slug || !isValidSlug(slug)) {
    throw new SignupError(400, 'Could not derive a valid workspace URL from that name — please pick a different one');
  }
  if (RESERVED_SUBDOMAINS.includes(slug)) {
    throw new SignupError(400, 'That workspace URL is reserved — please pick a different one');
  }
  if (!(await isSlugAvailable(slug))) {
    throw new SignupError(409, 'That workspace URL is already taken');
  }
  // Default shop is named after orgName; shop names are globally unique.
  if (!(await isShopNameAvailable(orgName))) {
    throw new SignupError(409, 'A shop with that name already exists — please choose a different business name');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  const organization = await createOrganization({ name: orgName.trim(), slug }).catch((err) => {
    logger.error('provisionWorkspace: organization creation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new SignupError(500, 'Failed to create organization');
  });

  const userId = uuidv4();
  const hashedPassword = await hashPassword(password);

  const { error: userError } = await supabaseAdmin.from('User').insert([{
    id: userId,
    email: normalizedEmail,
    password: hashedPassword,
    name: name.trim(),
    role: 'admin',
    twoFactorEnabled: false,
    organizationId: organization.id,
    createdAt: now,
    updatedAt: now,
  }]);
  if (userError) {
    await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
    if (userError.code === '23505') throw new SignupError(409, 'An account with that email already exists');
    logger.error('provisionWorkspace: user creation failed', { error: userError.message });
    throw new SignupError(500, 'Failed to create account');
  }

  const shopId = uuidv4();
  const { error: shopError } = await supabaseAdmin.from('Shop').insert([{
    id: shopId,
    name: orgName.trim(),
    location: 'Main',
    isActive: true,
    organizationId: organization.id,
    createdAt: now,
    updatedAt: now,
  }]);
  if (shopError) {
    await supabaseAdmin.from('User').delete().eq('id', userId);
    await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
    if (shopError.code === '23505') throw new SignupError(409, 'A shop with that name already exists — please choose a different business name');
    logger.error('provisionWorkspace: default shop creation failed', { error: shopError.message });
    throw new SignupError(500, 'Failed to set up workspace');
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
    logger.error('provisionWorkspace: portal user creation failed', { error: portalUserError.message });
    throw new SignupError(500, 'Failed to set up workspace');
  }

  // Email verification token — store only its hash.
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  await supabaseAdmin.from('EmailVerificationToken').insert([{
    id: uuidv4(),
    userId,
    organizationId: organization.id,
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString(),
    createdAt: now,
  }]);

  if (sendEmail) {
    const emailResult = await sendVerificationEmail({ to: normalizedEmail, name: name.trim(), orgName: orgName.trim(), orgSlug: slug, token: rawToken });
    if (!emailResult.ok) logger.warn('provisionWorkspace: verification email failed to send', { error: emailResult.error, userId });
  }

  const token = signAuthToken({ userId, organizationId: organization.id, email: normalizedEmail, role: 'admin', shopId });

  return {
    token,
    userId,
    normalizedEmail,
    organization: { id: organization.id, name: organization.name, slug: organization.slug, status: organization.status },
    shopId,
  };
}
