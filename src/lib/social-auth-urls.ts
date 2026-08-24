import { DEV_TENANT_SLUG } from './tenant';
import { getOrgUrl } from './urls';

/**
 * Google/Facebook only allow a fixed, pre-registered set of OAuth redirect
 * URIs, so the start/callback routes always run on the default tenant's
 * host — never the subdomain the login page happens to be on. `tenant`
 * carries the actual origin subdomain through as a query param so the
 * callback can scope the social-identity lookup to the right org.
 */
export function getGoogleStartUrl(currentTenantSlug: string | null): string {
  const tenant = currentTenantSlug || DEV_TENANT_SLUG;
  return getOrgUrl(DEV_TENANT_SLUG, `/api/portal/auth/google/start?tenant=${encodeURIComponent(tenant)}`);
}

export function getFacebookStartUrl(currentTenantSlug: string | null): string {
  const tenant = currentTenantSlug || DEV_TENANT_SLUG;
  return getOrgUrl(DEV_TENANT_SLUG, `/api/portal/auth/facebook/start?tenant=${encodeURIComponent(tenant)}`);
}
