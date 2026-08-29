import { ROOT_DOMAIN } from './tenant';

/** Minimal org shape needed to resolve a tenant's public host. */
export interface OrgUrlTarget {
  slug: string;
  customDomain?: string | null;
  customDomainStatus?: 'pending' | 'verified' | 'misconfigured' | null;
}

/**
 * Builds an absolute URL to a given tenant's portal + path, e.g.
 * getOrgUrl('acme', '/verify-email?token=abc') -> https://acme.royaltrack.royalgenegroup.co.ke/verify-email?token=abc
 *
 * When `customDomain` is passed it becomes the host instead of the platform
 * subdomain. Callers must only pass a domain whose customDomainStatus is
 * 'verified' — that's the same gate middleware enforces before routing a
 * custom domain's traffic (resolveOrganizationByCustomDomainEdge). Prefer
 * getOrgUrlFor(org, path), which applies that check for you.
 *
 * Custom domains are ignored in local dev (ROOT_DOMAIN is localhost) since
 * only the platform subdomain resolves there.
 * Handles the localhost dev case (bare host + port) correctly.
 */
export function getOrgUrl(slug: string, path: string = '/', customDomain?: string | null): string {
  const isLocal = ROOT_DOMAIN.startsWith('localhost');
  const protocol = isLocal ? 'http' : 'https';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const host = customDomain && !isLocal ? customDomain : `${slug}.${ROOT_DOMAIN}`;
  return `${protocol}://${host}${normalizedPath}`;
}

/**
 * getOrgUrl for a tenant record: uses the tenant's own custom domain when it
 * is verified, otherwise the platform subdomain.
 */
export function getOrgUrlFor(org: OrgUrlTarget, path: string = '/'): string {
  const verifiedDomain = org.customDomainStatus === 'verified' ? org.customDomain : null;
  return getOrgUrl(org.slug, path, verifiedDomain);
}
