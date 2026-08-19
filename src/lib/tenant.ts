// Edge-safe tenant resolution. Deliberately does NOT import '@/lib/supabase-client'
// — that module starts realtime stock-sync subscriptions as an import side-effect,
// which must not run on every middleware invocation (and may not be edge-safe at
// all). Uses a raw PostgREST fetch instead.

export const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost:3001').toLowerCase();
export const DEV_TENANT_SLUG = process.env.DEV_TENANT_SLUG || 'royalgene';

// Subdomains that are never a tenant slug — reserved for platform surfaces.
// "portal" is the production entry host (portal.<root-domain>) and is
// treated the same as the bare apex/www: it resolves to the default tenant
// (DEV_TENANT_SLUG), not a tenant slug lookup.
export const RESERVED_SUBDOMAINS = ['www', 'portal', 'api', 'app', 'admin', 'mail', 'platform'];

export interface ResolvedOrganization {
  id: string;
  slug: string;
  status: 'pending_verification' | 'active' | 'suspended' | 'cancelled';
  planTier: 'free' | 'starter' | 'pro' | 'enterprise' | 'legacy';
  trialEndsAt: string | null;
  billingStatus: string | null;
}

const ORG_SELECT_FIELDS = 'id,slug,status,planTier,trialEndsAt,billingStatus';

/**
 * True once a free-tier trial has run out with no active subscription.
 * "legacy" tier (grandfathered orgs, e.g. the original RoyalGene tenant)
 * never trial-gates. Paid tiers don't either — planTier only moves off
 * "free" once a subscription actually succeeds (src/lib/billing.server.ts),
 * so reaching a paid tier already implies billing is in order.
 */
export function isTrialExpired(org: ResolvedOrganization): boolean {
  if (org.planTier !== 'free') return false;
  if (org.billingStatus === 'active') return false;
  if (!org.trialEndsAt) return false;
  return new Date(org.trialEndsAt).getTime() < Date.now();
}

/**
 * Extracts the tenant slug from a Host header, given the configured root domain.
 * Returns null for the bare apex/www (treated as the legacy/default tenant by the
 * caller) or for a host that doesn't belong to the root domain at all (unrelated
 * host / future custom-domain support).
 */
export function extractSubdomain(host: string | null | undefined, rootDomain: string = ROOT_DOMAIN): string | null {
  if (!host) return null;
  const bareHost = host.split(':')[0].toLowerCase();
  const bareRoot = rootDomain.split(':')[0].toLowerCase();

  if (bareHost === bareRoot || bareHost === `www.${bareRoot}`) return null;
  if (!bareHost.endsWith(`.${bareRoot}`)) return null;

  const label = bareHost.slice(0, -(`.${bareRoot}`.length));
  if (!label || label.includes('.') || RESERVED_SUBDOMAINS.includes(label)) return null;
  return label;
}

/**
 * True for hosts that belong to our own root domain but aren't a tenant
 * slug (bare apex, www, portal, or any other reserved label) — these fall
 * back to the default tenant. False for a host extractSubdomain() also
 * returned null for but that ISN'T ours at all (a candidate custom domain).
 * Distinguishing these two null cases is what makes custom-domain
 * resolution possible without misrouting our own reserved hosts.
 */
export function isRootDomainHost(host: string | null | undefined, rootDomain: string = ROOT_DOMAIN): boolean {
  if (!host) return true;
  const bareHost = host.split(':')[0].toLowerCase();
  const bareRoot = rootDomain.split(':')[0].toLowerCase();

  if (bareHost === bareRoot || bareHost === `www.${bareRoot}`) return true;
  if (!bareHost.endsWith(`.${bareRoot}`)) return false;

  const label = bareHost.slice(0, -(`.${bareRoot}`.length));
  return RESERVED_SUBDOMAINS.includes(label);
}

/**
 * Resolves an Organization by slug via a raw PostgREST request (no supabase-js
 * import — keeps this module import-safe for Next.js middleware / edge runtime).
 */
export async function resolveOrganizationEdge(slug: string): Promise<ResolvedOrganization | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !slug) return null;

  try {
    const url = `${supabaseUrl}/rest/v1/Organization?slug=eq.${encodeURIComponent(slug)}&select=${ORG_SELECT_FIELDS}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as ResolvedOrganization[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves an Organization by a verified custom domain. Only ever matches
 * customDomainStatus='verified' — this filter is the actual security gate
 * that prevents an unverified/unproven domain claim from routing traffic,
 * not just a UI status label. See src/lib/domains.server.ts for how a
 * domain becomes verified.
 */
export async function resolveOrganizationByCustomDomainEdge(host: string): Promise<ResolvedOrganization | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bareHost = host.split(':')[0].toLowerCase();
  if (!supabaseUrl || !serviceKey || !bareHost) return null;

  try {
    const url = `${supabaseUrl}/rest/v1/Organization?customDomain=eq.${encodeURIComponent(bareHost)}&customDomainStatus=eq.verified&select=${ORG_SELECT_FIELDS}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as ResolvedOrganization[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
