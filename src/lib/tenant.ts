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
  /** End of the period the last payment covers; null = not tracked (never lapses). */
  paidThrough?: string | null;
}

const ORG_SELECT_FIELDS = 'id,slug,status,planTier,trialEndsAt,billingStatus,paidThrough';
// Without paidThrough, for a database the 20261017_01 migration hasn't reached
// yet: tenant resolution must never fail because of a billing column.
const ORG_SELECT_FIELDS_BASE = 'id,slug,status,planTier,trialEndsAt,billingStatus';

/** Days a workspace keeps full use after its paid period ends, while a renewal comes through. */
export const PAID_GRACE_DAYS = 3;

export type ReadOnlyReason = 'trial_ended' | 'plan_lapsed' | 'billing_suspended';

type BillingFields = Pick<ResolvedOrganization, 'planTier' | 'trialEndsAt' | 'billingStatus' | 'paidThrough'>;

/**
 * Why a workspace is read-only (it can still sign in, view and export, but
 * not change anything), or null when it has full use. Exempt (legacy)
 * workspaces never are.
 */
export function readOnlyReason(org: BillingFields, now: number = Date.now()): ReadOnlyReason | null {
  if (org.planTier === 'legacy') return null;
  if (org.billingStatus === 'suspended') return 'billing_suspended';
  if (org.planTier === 'free') {
    if (org.billingStatus === 'active' || !org.trialEndsAt) return null;
    return new Date(org.trialEndsAt).getTime() < now ? 'trial_ended' : null;
  }
  if (!org.paidThrough) return null;
  const graceEnd = new Date(org.paidThrough).getTime() + PAID_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return graceEnd < now ? 'plan_lapsed' : null;
}

export const READ_ONLY_MESSAGES: Record<ReadOnlyReason, string> = {
  trial_ended: 'Your free trial has ended, so this workspace is read-only. Subscribe to keep recording.',
  plan_lapsed: 'Your plan has expired, so this workspace is read-only. Renew to keep recording.',
  billing_suspended: 'Billing for this workspace is suspended, so it is read-only. Contact support to restore it.',
};

async function fetchOrganizationEdge(filter: string): Promise<ResolvedOrganization | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  for (const fields of [ORG_SELECT_FIELDS, ORG_SELECT_FIELDS_BASE]) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/Organization?${filter}&select=${fields}&limit=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        next: { revalidate: 30 },
      });
      if (res.status === 400) continue; // unknown column: retry without it
      if (!res.ok) return null;
      const rows = (await res.json()) as ResolvedOrganization[];
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }
  return null;
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
  if (!slug) return null;
  return fetchOrganizationEdge(`slug=eq.${encodeURIComponent(slug)}`);
}

/**
 * Resolves an Organization by a verified custom domain. Only ever matches
 * customDomainStatus='verified' — this filter is the actual security gate
 * that prevents an unverified/unproven domain claim from routing traffic,
 * not just a UI status label. See src/lib/domains.server.ts for how a
 * domain becomes verified.
 */
export async function resolveOrganizationByCustomDomainEdge(host: string): Promise<ResolvedOrganization | null> {
  const bareHost = host.split(':')[0].toLowerCase();
  if (!bareHost) return null;
  return fetchOrganizationEdge(`customDomain=eq.${encodeURIComponent(bareHost)}&customDomainStatus=eq.verified`);
}
