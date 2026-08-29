import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { BRANDING_DEFAULTS, MAX_BRANDING_DATA_URI_BYTES, type TenantBranding } from './branding';
import logger from './logger';

const SELECT = 'name, tagline, logoUrl, faviconUrl';

function rowToBranding(row: { name?: string | null; tagline?: string | null; logoUrl?: string | null; faviconUrl?: string | null } | null): TenantBranding {
  if (!row) return BRANDING_DEFAULTS;
  return {
    companyName: row.name?.trim() || BRANDING_DEFAULTS.companyName,
    tagline: row.tagline?.trim() || BRANDING_DEFAULTS.tagline,
    logoUrl: row.logoUrl || null,
    faviconUrl: row.faviconUrl || null,
  };
}

/**
 * Resolve a tenant's branding. Called from generateMetadata() and the root
 * layout body — two small indexed lookups per request, which is fine at this
 * scale. Falls back to defaults for a missing org id (tenant-optional routes).
 */
export async function getTenantBranding(organizationId: string | null | undefined): Promise<TenantBranding> {
  if (!organizationId) return BRANDING_DEFAULTS;
  try {
    const { data } = await supabaseAdmin
      .from('Organization')
      .select(SELECT)
      .eq('id', organizationId)
      .maybeSingle();
    return rowToBranding(data);
  } catch (err) {
    logger.warn('[branding] getTenantBranding failed', { organizationId, error: err instanceof Error ? err.message : String(err) });
    return BRANDING_DEFAULTS;
  }
}

export interface BrandingPatch {
  companyName?: string;
  tagline?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
}

function validImageValue(v: string | null | undefined, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (!v.startsWith('data:image/')) throw new Error(`${field} must be an image data URI`);
  if (Buffer.byteLength(v, 'utf8') > MAX_BRANDING_DATA_URI_BYTES) {
    throw new Error(`${field} is too large — upload a smaller image`);
  }
  return v;
}

/** Org admin: update this tenant's branding. `null` for logoUrl/faviconUrl clears it. */
export async function updateTenantBranding(organizationId: string, patch: BrandingPatch): Promise<TenantBranding> {
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (patch.companyName !== undefined) {
    const name = patch.companyName.trim();
    if (name.length < 2 || name.length > 100) throw new Error('Company name must be 2–100 characters');
    update.name = name;
  }
  if (patch.tagline !== undefined) {
    const tagline = patch.tagline.trim();
    if (tagline.length > 120) throw new Error('Tagline must be 120 characters or fewer');
    update.tagline = tagline || null;
  }
  if (patch.logoUrl !== undefined) update.logoUrl = validImageValue(patch.logoUrl, 'logoUrl');
  if (patch.faviconUrl !== undefined) update.faviconUrl = validImageValue(patch.faviconUrl, 'faviconUrl');

  const { data, error } = await supabaseAdmin
    .from('Organization')
    .update(update)
    .eq('id', organizationId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return rowToBranding(data);
}
