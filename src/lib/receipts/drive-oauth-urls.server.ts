import 'server-only';
import { DEV_TENANT_SLUG } from '../tenant';
import { getOrgUrl } from '../urls';

/**
 * Google only accepts pre-registered redirect URIs, so the Drive consent
 * always comes back to the default tenant's host (like "Sign in with
 * Google"); the signed state says which workspace it was for. Register this
 * URL on the web OAuth client in Google Cloud.
 */
export function driveCallbackUrl(): string {
  return getOrgUrl(DEV_TENANT_SLUG, '/api/portal/integrations/google-drive/callback');
}
