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
 * Resolves an Organization by slug via a raw PostgREST request (no supabase-js
 * import — keeps this module import-safe for Next.js middleware / edge runtime).
 */
export async function resolveOrganizationEdge(slug: string): Promise<ResolvedOrganization | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !slug) return null;

  try {
    const url = `${supabaseUrl}/rest/v1/Organization?slug=eq.${encodeURIComponent(slug)}&select=id,slug,status&limit=1`;
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
