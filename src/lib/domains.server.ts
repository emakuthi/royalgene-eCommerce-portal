import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { addDomainToProject, getDomainConfig, removeDomainFromProject } from './vercel.server';

/** Domain labels: lowercase, dot-separated, standard hostname characters. Allows apex or subdomain. */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain.toLowerCase());
}

export interface DomainInstructions {
  cnameTarget: string;
  aRecordTarget: string;
  verification: { type: string; domain: string; value: string }[];
}

export interface DomainState {
  domain: string | null;
  status: 'pending' | 'verified' | 'misconfigured' | null;
  instructions: DomainInstructions | null;
  error?: string;
}

/** Attaches a new custom domain to an organization. Always starts 'pending' — see resolveOrganizationByCustomDomainEdge for why. */
export async function setCustomDomain(organizationId: string, domain: string): Promise<DomainState> {
  const normalized = domain.trim().toLowerCase();
  if (!isValidDomain(normalized)) {
    return { domain: null, status: null, instructions: null, error: 'That doesn\'t look like a valid domain' };
  }

  const addResult = await addDomainToProject(normalized);
  if (!addResult.ok) {
    return { domain: null, status: null, instructions: null, error: addResult.error };
  }

  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ customDomain: normalized, customDomainStatus: 'pending', updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
  if (error) {
    return { domain: null, status: null, instructions: null, error: error.message };
  }

  const state = await refreshCustomDomainStatus(organizationId);
  // Vercel's ownership-proof TXT challenge (only returned when the domain
  // needs it, e.g. it's already attached elsewhere) is only available right
  // after adding — surface it now; subsequent "Check status" refreshes only
  // report the CNAME/A DNS-pointing check.
  if (state.instructions && addResult.data.verification.length > 0) {
    state.instructions.verification = addResult.data.verification.map((v) => ({ type: v.type, domain: v.domain, value: v.value }));
  }
  return state;
}

/** Re-checks the domain's DNS state with Vercel and updates the stored status accordingly. */
export async function refreshCustomDomainStatus(organizationId: string): Promise<DomainState> {
  const { data: org } = await supabaseAdmin
    .from('Organization')
    .select('customDomain, customDomainStatus')
    .eq('id', organizationId)
    .maybeSingle();

  if (!org?.customDomain) {
    return { domain: null, status: null, instructions: null };
  }

  const configResult = await getDomainConfig(org.customDomain);
  if (!configResult.ok) {
    return { domain: org.customDomain, status: org.customDomainStatus, instructions: null, error: configResult.error };
  }

  const nextStatus = configResult.data.misconfigured ? 'misconfigured' : 'verified';
  if (nextStatus !== org.customDomainStatus) {
    await supabaseAdmin
      .from('Organization')
      .update({ customDomainStatus: nextStatus, updatedAt: new Date().toISOString() })
      .eq('id', organizationId);
  }

  return {
    domain: org.customDomain,
    status: nextStatus,
    instructions: {
      cnameTarget: configResult.data.cnameTarget,
      aRecordTarget: configResult.data.aRecordTarget,
      verification: [],
    },
  };
}

export async function removeCustomDomain(organizationId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: org } = await supabaseAdmin
    .from('Organization')
    .select('customDomain')
    .eq('id', organizationId)
    .maybeSingle();

  if (org?.customDomain) {
    const result = await removeDomainFromProject(org.customDomain);
    if (!result.ok) return { ok: false, error: result.error };
  }

  const { error } = await supabaseAdmin
    .from('Organization')
    .update({ customDomain: null, customDomainStatus: null, updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
