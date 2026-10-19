// Shared branding types + defaults (safe to import from client or server).
// Persistence lives in branding.server.ts (Organization columns); the client
// reads/writes it through /api/portal/branding via BrandingProvider.

export interface TenantBranding {
  /** Organization.name */
  companyName: string;
  /** Organization.tagline, or the default */
  tagline: string;
  /** Organization.logoUrl — small resized data URI, or null for the default mark */
  logoUrl: string | null;
  /** Organization.faviconUrl — small resized data URI, or null for the default set */
  faviconUrl: string | null;
  /** Organization.currency (ISO 4217) — the tenant's base currency for all money display. */
  currency: string;
  /** Organization.usdRate — owner-set units of base currency per 1 USD; null => no "≈ $" label. */
  usdRate: number | null;
  /** Organization.businessType — see business-types.ts. */
  businessType: string;
  /** Name of product option 1 (stored in the size columns); '' = off. */
  option1Label: string;
  /** Name of product option 2 (stored in the color columns); '' = off. */
  option2Label: string;
  /** Set while the workspace is read-only (trial ended / plan lapsed); null = full use. */
  readOnly: { reason: string; message: string } | null;
  /** When an M-Pesa-paid plan runs out within a few days (it doesn't renew by itself); null otherwise. */
  renewalDueAt: string | null;
}

export const BRANDING_DEFAULTS: TenantBranding = {
  companyName: 'Royal Gene',
  tagline: 'Management Portal',
  logoUrl: null,
  faviconUrl: null,
  currency: 'KES',
  usdRate: null,
  businessType: 'boutique',
  option1Label: 'Size',
  option2Label: 'Colour',
  readOnly: null,
  renewalDueAt: null,
};

/** <link rel="icon"> hrefs shipped by default, restored when a tenant clears its custom favicon. */
export const DEFAULT_FAVICON_LINKS = ['/favicon.ico', '/favicon-32.png', '/favicon-192.png'];

/** Max bytes for a stored logo/favicon data URI (they're resized client-side well below this). */
export const MAX_BRANDING_DATA_URI_BYTES = 256 * 1024;
