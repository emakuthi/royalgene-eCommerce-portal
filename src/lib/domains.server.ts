import 'server-only';
import { promises as dns } from 'node:dns';
import { supabaseAdmin } from './supabase-client';
import { ROOT_DOMAIN } from './tenant';
import type { DomainInstructions, DomainState } from './domains';

export type { DomainInstructions, DomainState } from './domains';

// Custom domains are served by the VPS's own nginx. The portal only records a
// workspace's domain and checks that it reaches the server. The VPS runs
// scripts/vps/custom-domains.sh every few minutes: once the domain reaches the
// server it issues the certificate, adds the nginx site and marks the domain
// 'verified', which is when the middleware starts routing it to the workspace.
// The script also removes the site of a domain no workspace uses any more.

/** The VPS's public address, for customers' A records. */
const SERVER_IP = process.env.CUSTOM_DOMAIN_SERVER_IP || '195.110.58.34';
/** The VPS nginx answers this on port 80 for any host (see the script). */
const CHECK_PATH = '/.well-known/acme-challenge/royaltrack-domain-check';
const CHECK_BODY = 'royaltrack-ok';

/** Domain labels: lowercase, dot-separated, standard hostname characters. Allows apex or subdomain. */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain.toLowerCase());
}

const rootHost = (): string => ROOT_DOMAIN.split(':')[0];

function instructions(): DomainInstructions {
  return { cnameTarget: rootHost(), aRecordTarget: SERVER_IP, verification: [] };
}

/**
 * Whether the domain reaches this server: nginx's check file answers over
 * plain HTTP (this also works behind a Cloudflare proxy), or its DNS points
 * straight at the VPS (in case the server can't reach its own public address).
 */
export async function domainReachesServer(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${domain}${CHECK_PATH}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok && (await res.text()).trim() === CHECK_BODY) return true;
  } catch {
    // fall through to the DNS check
  }
  try {
    return (await dns.resolve4(domain)).includes(SERVER_IP);
  } catch {
    return false;
  }
}

/** Attaches a new custom domain to an organization. Always starts 'pending' — see resolveOrganizationByCustomDomainEdge for why. */
export async function setCustomDomain(organizationId: string, domain: string): Promise<DomainState> {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!isValidDomain(normalized)) {
    return { domain: null, status: null, instructions: null, error: 'That doesn\'t look like a valid domain' };
  }
  const root = rootHost();
  if (normalized === root || normalized.endsWith(`.${root}`)) {
    return { domain: null, status: null, instructions: null, error: 'That is already a RoyalTrack address. Enter a domain you own.' };
  }

  const { data: taken } = await supabaseAdmin
    .from('Organization')
    .select('id')
    .eq('customDomain', normalized)
    .neq('id', organizationId)
    .limit(1)
    .maybeSingle();
  if (taken) {
    return { domain: null, status: null, instructions: null, error: 'That domain is already used by another workspace.' };
  }

  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ customDomain: normalized, customDomainStatus: 'pending', updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
  if (error) {
    return { domain: null, status: null, instructions: null, error: error.message };
  }

  return refreshCustomDomainStatus(organizationId);
}

/**
 * Re-checks whether the domain reaches the server. Only the VPS script marks a
 * domain 'verified' (its certificate and site are live by then), and a
 * verified domain is never downgraded here: a failed check from inside the
 * server is weaker evidence than the live site.
 */
export async function refreshCustomDomainStatus(organizationId: string): Promise<DomainState> {
  const { data: org } = await supabaseAdmin
    .from('Organization')
    .select('customDomain, customDomainStatus')
    .eq('id', organizationId)
    .maybeSingle();

  if (!org?.customDomain) {
    return { domain: null, status: null, instructions: null };
  }

  const reachable = await domainReachesServer(org.customDomain);
  const status: DomainState['status'] = org.customDomainStatus === 'verified' ? 'verified' : reachable ? 'pending' : 'misconfigured';
  if (status !== org.customDomainStatus) {
    await supabaseAdmin
      .from('Organization')
      .update({ customDomainStatus: status, updatedAt: new Date().toISOString() })
      .eq('id', organizationId);
  }

  return { domain: org.customDomain, status, reachable, instructions: instructions() };
}

/** Frees the domain; the VPS script removes its site and certificate on its next run. */
export async function removeCustomDomain(organizationId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ customDomain: null, customDomainStatus: null, updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
