import 'server-only';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import { hashPassword } from './auth.server';
import { createOrganization, isSlugAvailable, isValidSlug, slugify } from './organizations.server';
import { RESERVED_SUBDOMAINS } from './tenant';
import logger from './logger';

export interface SocialIdentity {
  /** Already lowercased, and already verified by the provider (Google/Facebook) — never re-verified here. */
  email: string;
  name: string | null;
  provider: 'google' | 'facebook';
}

async function uniqueSlugFor(baseName: string): Promise<string> {
  const base = slugify(baseName) || 'workspace';
  let candidate = base;
  let suffix = 1;
  // Auto-generated org names ("Jane's Workspace") collide far more often
  // than user-chosen ones from the signup form, so this retries with a
  // numeric suffix instead of failing outright.
  while (!isValidSlug(candidate) || RESERVED_SUBDOMAINS.includes(candidate) || !(await isSlugAvailable(candidate))) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 50) throw new Error('Could not generate a unique workspace URL');
  }
  return candidate;
}

/**
 * Finds the existing User for a verified social identity, or auto-provisions
 * a brand-new tenant (Organization + admin User + default Shop + PortalUser)
 * for it — mirroring /api/auth/signup's orchestration exactly, minus the
 * email-verification-token step (the provider already verified the email).
 * Scoped the same way mobile login is: to the host's resolved org, or
 * platform-level users when there is none.
 */
export async function findOrProvisionUserForSocialIdentity(
  identity: SocialIdentity,
  hostOrgId: string | null,
): Promise<{ userId: string; isNewUser: boolean }> {
  let userQuery = supabaseAdmin.from('User').select('id').eq('email', identity.email);
  userQuery = hostOrgId ? userQuery.or(`organizationId.eq.${hostOrgId},organizationId.is.null`) : userQuery.is('organizationId', null);
  const { data: existing } = await userQuery.maybeSingle();
  if (existing) return { userId: existing.id, isNewUser: false };

  const fallbackName = identity.email.split('@')[0];
  const orgName = `${identity.name ?? fallbackName}'s Workspace`;
  const slug = await uniqueSlugFor(orgName);

  const organization = await createOrganization({ name: orgName, slug });

  const now = new Date().toISOString();
  const userId = uuidv4();
  // No password exists for a social-only account — a random one is hashed
  // and stored (the column is NOT NULL) but never revealed; the user can
  // set a real one later via "Forgot password" if they ever want it.
  const randomPasswordHash = await hashPassword(randomBytes(32).toString('hex'));

  const { error: userError } = await supabaseAdmin.from('User').insert([{
    id: userId,
    email: identity.email,
    password: randomPasswordHash,
    name: identity.name ?? fallbackName,
    role: 'admin',
    twoFactorEnabled: false,
    organizationId: organization.id,
    createdAt: now,
    updatedAt: now,
  }]);
  if (userError) {
    await supabaseAdmin.from('Organization').delete().eq('id', organization.id);
    logger.error('Social sign-in: user creation failed', { provider: identity.provider, error: userError.message });
    throw new Error('Failed to create account');
  }

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
    logger.error('Social sign-in: default shop creation failed', { provider: identity.provider, error: shopError.message });
    throw new Error('Failed to set up workspace');
  }

  const { error: portalUserError } = await supabaseAdmin.from('PortalUser').insert([{
    id: uuidv4(),
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
    logger.error('Social sign-in: portal user creation failed', { provider: identity.provider, error: portalUserError.message });
    throw new Error('Failed to set up workspace');
  }

  logger.info('Social sign-in: auto-provisioned new tenant', {
    provider: identity.provider, userId, organizationId: organization.id, slug,
  });

  return { userId, isNewUser: true };
}
