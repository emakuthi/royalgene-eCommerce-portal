import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { ROOT_DOMAIN } from './tenant';
import { addDomainToProject, isVercelConfigured } from './vercel.server';
import type { Organization } from './types';
import logger from './logger';

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as Organization;
}

export async function getOrganizationById(id: string): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Organization;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Organization')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  return !data;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  createdBy?: string | null;
}

const TRIAL_DAYS = 14;

export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .insert([{
      name: input.name,
      slug: input.slug,
      status: 'pending_verification',
      planTier: 'free',
      trialEndsAt,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    }])
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create organization');
  }

  await createTrialSubscription(data.id, trialEndsAt);
  await registerTenantSubdomain(input.slug);

  return data as Organization;
}

/**
 * Attach <slug>.<ROOT_DOMAIN> to the Vercel project so the tenant's subdomain
 * serves over HTTPS immediately after signup. Vercel issues a per-host cert
 * automatically (HTTP-01) — this does NOT depend on a *.<ROOT_DOMAIN> wildcard
 * cert existing. Fire-and-forget: a failure (Vercel not configured, API
 * hiccup, domain already attached) must never block signup — the middleware
 * still resolves the tenant by slug regardless, only TLS would be delayed.
 */
async function registerTenantSubdomain(slug: string): Promise<void> {
  if (ROOT_DOMAIN.startsWith('localhost')) return;
  if (!isVercelConfigured()) return;

  const host = `${slug}.${ROOT_DOMAIN.split(':')[0]}`;
  try {
    const result = await addDomainToProject(host);
    if (!result.ok) {
      logger.warn('[organizations] registerTenantSubdomain: Vercel add failed', { host, error: result.error });
    }
  } catch (err) {
    logger.warn('[organizations] registerTenantSubdomain threw', {
      host,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * New tenants get Professional-level entitlements during their trial (per
 * the subscription spec), not Starter — TenantSubscription.planId points at
 * Professional while Organization.planTier stays 'free' so the existing
 * middleware trial-lockout logic (which only ever reads Organization) is
 * unaffected. Fails soft: a missing Professional plan (e.g. seed migration
 * not run yet) must never block signup — it just means entitlements resolve
 * to "no plan" (blocked creation, not blocked signup) until an admin seeds plans.
 */
async function createTrialSubscription(organizationId: string, trialEndsAt: string): Promise<void> {
  const { data: professionalPlan } = await supabaseAdmin.from('PlatformPlan').select('id').eq('tier', 'pro').maybeSingle();
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from('TenantSubscription').insert([{
    organizationId,
    planId: professionalPlan?.id ?? null,
    status: 'trialing',
    trialStart: now,
    trialEnd: trialEndsAt,
    createdAt: now,
    updatedAt: now,
  }]);

  if (error) {
    logger.warn('[organizations] failed to create trial TenantSubscription', { error: error.message, organizationId });
  }
}

export async function activateOrganization(organizationId: string): Promise<void> {
  await supabaseAdmin
    .from('Organization')
    .update({ status: 'active', updatedAt: new Date().toISOString() })
    .eq('id', organizationId)
    .eq('status', 'pending_verification');
}

export interface OrganizationWithCounts extends Organization {
  userCount: number;
  shopCount: number;
}

/** Platform-admin view: every organization, with per-org user/shop counts. */
export async function listOrganizations(): Promise<OrganizationWithCounts[]> {
  const { data: orgs, error } = await supabaseAdmin
    .from('Organization')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error || !orgs) return [];

  const withCounts = await Promise.all(
    (orgs as Organization[]).map(async (org) => {
      const [{ count: userCount }, { count: shopCount }] = await Promise.all([
        supabaseAdmin.from('User').select('*', { count: 'exact', head: true }).eq('organizationId', org.id),
        supabaseAdmin.from('Shop').select('*', { count: 'exact', head: true }).eq('organizationId', org.id),
      ]);
      return { ...org, userCount: userCount ?? 0, shopCount: shopCount ?? 0 };
    }),
  );

  return withCounts;
}

export async function updateOrganizationStatus(
  organizationId: string,
  status: Organization['status'],
): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .update({ status, updatedAt: new Date().toISOString() })
    .eq('id', organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Organization | null;
}

export async function updateOrganizationPlan(
  organizationId: string,
  planTier: Organization['planTier'],
): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from('Organization')
    .update({ planTier, updatedAt: new Date().toISOString() })
    .eq('id', organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Organization | null;
}

export interface PlatformOverview {
  totalOrganizations: number;
  organizationsByStatus: Record<Organization['status'], number>;
  totalUsers: number;
  totalShops: number;
}

/** Platform-wide stats, cross-tenant — for the super_admin overview tiles. */
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const { data: orgs } = await supabaseAdmin.from('Organization').select('status');
  const organizationsByStatus: Record<Organization['status'], number> = {
    pending_verification: 0,
    active: 0,
    suspended: 0,
    cancelled: 0,
  };
  for (const row of (orgs ?? []) as Array<{ status: Organization['status'] }>) {
    organizationsByStatus[row.status] = (organizationsByStatus[row.status] ?? 0) + 1;
  }

  const [{ count: totalUsers }, { count: totalShops }] = await Promise.all([
    supabaseAdmin.from('User').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('Shop').select('*', { count: 'exact', head: true }),
  ]);

  return {
    totalOrganizations: orgs?.length ?? 0,
    organizationsByStatus,
    totalUsers: totalUsers ?? 0,
    totalShops: totalShops ?? 0,
  };
}

/** Slugs are subdomain labels: lowercase alphanumeric + hyphens, 3-63 chars, no leading/trailing hyphen. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
