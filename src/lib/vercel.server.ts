import 'server-only';
import logger from './logger';

const VERCEL_BASE_URL = 'https://api.vercel.com';

function getConfig(): { token: string; projectId: string; teamId?: string } | null {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  const teamId = process.env.VERCEL_TEAM_ID || undefined;
  return { token, projectId, teamId };
}

export const isVercelConfigured = (): boolean => Boolean(getConfig());

function withTeamQuery(path: string, teamId?: string): string {
  if (!teamId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`;
}

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const config = getConfig();
  if (!config) {
    return { ok: false, error: 'Domain management is not configured (VERCEL_API_TOKEN/VERCEL_PROJECT_ID missing)' };
  }
  try {
    const res = await fetch(`${VERCEL_BASE_URL}${withTeamQuery(path, config.teamId)}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.error?.message === 'string' ? json.error.message : `Vercel responded ${res.status}`;
      logger.warn('[vercel] request failed', { path, status: res.status, message });
      return { ok: false, error: message };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    logger.error('[vercel] request threw', { path, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : 'Vercel request failed' };
  }
}

export interface VercelDomainVerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

export interface AddDomainResult {
  verified: boolean;
  verification: VercelDomainVerificationChallenge[];
}

/** Adds a domain to the Vercel project. Idempotent — re-adding an already-attached domain just returns its current state. */
export async function addDomainToProject(domain: string): Promise<{ ok: true; data: AddDomainResult } | { ok: false; error: string }> {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Domain management is not configured (VERCEL_API_TOKEN/VERCEL_PROJECT_ID missing)' };

  const result = await vercelFetch<{ verified?: boolean; verification?: VercelDomainVerificationChallenge[] }>(
    `/v10/projects/${config.projectId}/domains`,
    { method: 'POST', body: JSON.stringify({ name: domain }) },
  );
  if (!result.ok) return result;
  return { ok: true, data: { verified: Boolean(result.data.verified), verification: result.data.verification || [] } };
}

export interface VercelDomainConfig {
  misconfigured: boolean;
  cnameTarget: string;
  aRecordTarget: string;
}

interface VercelDomainConfigResponse {
  misconfigured?: boolean;
  recommendedCNAME?: { rank: number; value: string }[];
  recommendedIPv4?: { rank: number; value: string[] }[];
}

/** Checks whether a domain's DNS currently points correctly at this Vercel project. */
export async function getDomainConfig(domain: string): Promise<{ ok: true; data: VercelDomainConfig } | { ok: false; error: string }> {
  const result = await vercelFetch<VercelDomainConfigResponse>(`/v6/domains/${encodeURIComponent(domain)}/config`, { method: 'GET' });
  if (!result.ok) return result;

  // Vercel returns account/domain-specific recommended targets (ranked) —
  // these are the actually-correct values to show, not generic fallbacks.
  const topCname = result.data.recommendedCNAME?.slice().sort((a, b) => a.rank - b.rank)[0]?.value;
  const topIpv4 = result.data.recommendedIPv4?.slice().sort((a, b) => a.rank - b.rank)[0]?.value?.[0];

  return {
    ok: true,
    data: {
      misconfigured: Boolean(result.data.misconfigured),
      cnameTarget: (topCname || 'cname.vercel-dns.com').replace(/\.$/, ''),
      aRecordTarget: topIpv4 || '76.76.21.21',
    },
  };
}

export async function removeDomainFromProject(domain: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Domain management is not configured (VERCEL_API_TOKEN/VERCEL_PROJECT_ID missing)' };

  const result = await vercelFetch(`/v9/projects/${config.projectId}/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
  if (!result.ok) return result;
  return { ok: true };
}
