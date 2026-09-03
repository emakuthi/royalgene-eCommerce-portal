import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ROOT_DOMAIN, isRootDomainHost } from '@/lib/tenant';

// Only the platform host has public, indexable pages. Tenant workspace hosts
// return an empty sitemap.
const PUBLIC_PATHS = ['/', '/pricing', '/signup', '/login'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');
  if (!isRootDomainHost(host)) return [];

  const proto = ROOT_DOMAIN.startsWith('localhost') ? 'http' : 'https';
  const base = host ? `${proto}://${host}` : `https://${ROOT_DOMAIN}`;
  const now = new Date();

  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: path === '/' ? 1 : 0.7,
  }));
}
