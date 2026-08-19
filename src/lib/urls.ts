import { ROOT_DOMAIN } from './tenant';

/**
 * Builds an absolute URL to a given tenant's subdomain + path, e.g.
 * getOrgUrl('acme', '/verify-email?token=abc') -> https://acme.royalgene.app/verify-email?token=abc
 * Handles the localhost dev case (bare host + port) correctly.
 */
export function getOrgUrl(slug: string, path: string = '/'): string {
  const isLocal = ROOT_DOMAIN.startsWith('localhost');
  const protocol = isLocal ? 'http' : 'https';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${slug}.${ROOT_DOMAIN}${normalizedPath}`;
}
