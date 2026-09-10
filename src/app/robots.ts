import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ROOT_DOMAIN, isRootDomainHost } from '@/lib/tenant';

// Host-aware robots.txt.
//
// - Platform host (royaltrack.royalgenegroup.co.ke / www): the marketing
//   funnel is crawlable, the app is not.
// - Every other host — tenant subdomains and verified custom domains — is a
//   private workspace: disallow everything.
// - AI scrapers/trainers are disallowed everywhere (a B2B portal has nothing
//   for them to index). Note this is advisory; the hard block is Cloudflare's
//   "Block AI bots" toggle.

const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'PerplexityBot',
  'Applebot-Extended',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'FacebookBot',
  'Diffbot',
  'ImagesiftBot',
  'Omgilibot',
  'Timpibot',
  'cohere-ai',
  'YouBot',
];

const APP_DISALLOW = ['/dashboard', '/settings', '/stock', '/sales', '/shops', '/users', '/alerts', '/analytics', '/activity', '/platform', '/api/', '/session-bridge', '/verify-email'];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host');
  const isPlatformHost = isRootDomainHost(host);
  const proto = ROOT_DOMAIN.startsWith('localhost') ? 'http' : 'https';
  const base = host ? `${proto}://${host}` : `https://${ROOT_DOMAIN}`;

  const aiRules = AI_BOTS.map((ua) => ({ userAgent: ua, disallow: '/' }));

  if (!isPlatformHost) {
    // Tenant workspace host — nothing here should be indexed.
    return {
      rules: [{ userAgent: '*', disallow: '/' }, ...aiRules],
    };
  }

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: APP_DISALLOW },
      ...aiRules,
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
