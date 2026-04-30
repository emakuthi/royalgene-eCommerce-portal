export interface BrandingConfig {
  logoSrc: string | null;   // base64 data URL or null (use default /favicon.png)
  companyName: string;
  tagline: string;
}

export const BRANDING_DEFAULTS: BrandingConfig = {
  logoSrc: null,
  companyName: 'Royal Gene',
  tagline: 'Management Portal',
};

const KEY = 'portal-branding';
const EVENT = 'portal-branding-change';

export function loadBranding(): BrandingConfig {
  if (typeof window === 'undefined') return BRANDING_DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return BRANDING_DEFAULTS;
    return { ...BRANDING_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return BRANDING_DEFAULTS;
  }
}

export function saveBranding(config: Partial<BrandingConfig>) {
  const current = loadBranding();
  const next = { ...current, ...config };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function resetBranding() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: BRANDING_DEFAULTS }));
}

export { EVENT as BRANDING_EVENT };

