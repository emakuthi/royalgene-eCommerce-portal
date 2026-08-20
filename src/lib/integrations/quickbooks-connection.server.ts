import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import { decryptSecret, encryptSecret } from '../crypto/secret-box.server';
import { refreshAccessToken } from '../accounting/quickbooks.server';
import logger from '../logger';

const PROVIDER = 'quickbooks';

export interface QuickBooksConnectionSummary {
  connected: boolean;
  realmId: string | null;
  connectedAt: string | null;
}

interface ConnectionRow {
  externalAccountId: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  connectedBy: string | null;
}

export async function getQuickBooksConnectionSummary(organizationId: string): Promise<QuickBooksConnectionSummary> {
  const { data } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .select('externalAccountId, isActive, createdAt')
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (!data || !data.isActive) return { connected: false, realmId: null, connectedAt: null };
  return { connected: true, realmId: data.externalAccountId as string | null, connectedAt: data.createdAt as string };
}

export async function saveQuickBooksConnection(
  organizationId: string,
  input: { realmId: string; accessToken: string; refreshToken: string; expiresInSeconds: number; connectedBy?: string | null },
): Promise<void> {
  const now = new Date();
  const { error } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .upsert(
      [{
        organizationId,
        provider: PROVIDER,
        externalAccountId: input.realmId,
        encryptedAccessToken: encryptSecret(input.accessToken),
        encryptedRefreshToken: encryptSecret(input.refreshToken),
        tokenExpiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
        connectedBy: input.connectedBy ?? null,
        isActive: true,
        updatedAt: now.toISOString(),
      }],
      { onConflict: 'organizationId,provider' },
    );

  if (error) throw new Error(error.message);
}

export async function disconnectQuickBooks(organizationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .delete()
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER);

  if (error) throw new Error(error.message);
}

/**
 * Returns a live access token for this org's QuickBooks connection, auto-
 * refreshing (and persisting the refreshed token) if it's within 5 minutes
 * of expiry. Returns null if not connected — callers treat that as "skip
 * this sync," never as an error.
 */
export async function getValidAccessToken(organizationId: string): Promise<{ realmId: string; accessToken: string } | null> {
  const { data } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .select('*')
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (!data || !data.isActive) return null;
  const row = data as ConnectionRow;
  if (!row.encryptedAccessToken || !row.encryptedRefreshToken || !row.externalAccountId) return null;

  const expiresAt = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : 0;
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) {
    return { realmId: row.externalAccountId, accessToken: decryptSecret(row.encryptedAccessToken) };
  }

  const refreshToken = decryptSecret(row.encryptedRefreshToken);
  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed.ok) {
    logger.warn('[quickbooks] token refresh failed', { organizationId, error: refreshed.error });
    return null;
  }

  await saveQuickBooksConnection(organizationId, {
    realmId: row.externalAccountId,
    accessToken: refreshed.data.access_token,
    refreshToken: refreshed.data.refresh_token,
    expiresInSeconds: refreshed.data.expires_in,
    connectedBy: row.connectedBy,
  });

  return { realmId: row.externalAccountId, accessToken: refreshed.data.access_token };
}
