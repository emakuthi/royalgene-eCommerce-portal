import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import { decryptSecret, encryptSecret } from '../crypto/secret-box.server';
import { refreshDriveToken, revokeDriveToken } from '../google-drive.server';
import logger from '../logger';

/**
 * The workspace's Google Drive connection for receipts: one per organization,
 * a TenantOAuthConnection row with provider 'google_drive'. externalAccountId
 * holds the "RoyalTrack Receipts" folder id, externalAccountLabel the Google
 * account's email. Tokens are encrypted (CREDENTIALS_ENCRYPTION_KEY).
 */

const PROVIDER = 'google_drive';

export interface DriveConnectionSummary {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  /** True when Google stopped accepting the saved access (removed in the Google account): connect again. */
  needsReconnect: boolean;
}

interface ConnectionRow {
  externalAccountId: string | null;
  externalAccountLabel: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  connectedBy: string | null;
}

async function loadRow(organizationId: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .select('*')
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export async function getDriveConnectionSummary(organizationId: string): Promise<DriveConnectionSummary> {
  const row = await loadRow(organizationId);
  if (!row) return { connected: false, email: null, connectedAt: null, needsReconnect: false };
  return {
    connected: row.isActive,
    email: row.externalAccountLabel,
    connectedAt: row.createdAt,
    needsReconnect: !row.isActive,
  };
}

export async function saveDriveConnection(
  organizationId: string,
  input: { accessToken: string; refreshToken: string; expiresAt: number; email: string | null; folderId: string; connectedBy: string | null },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .upsert(
      [{
        organizationId,
        provider: PROVIDER,
        externalAccountId: input.folderId,
        externalAccountLabel: input.email,
        encryptedAccessToken: encryptSecret(input.accessToken),
        encryptedRefreshToken: encryptSecret(input.refreshToken),
        tokenExpiresAt: new Date(input.expiresAt).toISOString(),
        connectedBy: input.connectedBy,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      { onConflict: 'organizationId,provider' },
    );
  if (error) throw new Error(error.message);
}

export async function setDriveFolder(organizationId: string, folderId: string): Promise<void> {
  await supabaseAdmin
    .from('TenantOAuthConnection')
    .update({ externalAccountId: folderId, updatedAt: new Date().toISOString() })
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER);
}

/** Forgets the connection and tells Google to drop the grant. Receipts already in Drive stay there. */
export async function disconnectDrive(organizationId: string): Promise<void> {
  const row = await loadRow(organizationId);
  if (row?.encryptedRefreshToken) {
    try {
      await revokeDriveToken(decryptSecret(row.encryptedRefreshToken));
    } catch (err) {
      logger.warn('[drive] could not read token to revoke', { organizationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const { error } = await supabaseAdmin
    .from('TenantOAuthConnection')
    .delete()
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER);
  if (error) throw new Error(error.message);
}

export type DriveAccess =
  | { ok: true; accessToken: string; folderId: string }
  | { ok: false; reason: 'not_connected' | 'reconnect' | 'unavailable' };

/** A live access token plus the receipts folder, refreshing the token when it's within 5 minutes of expiry. */
export async function getDriveAccess(organizationId: string): Promise<DriveAccess> {
  const row = await loadRow(organizationId);
  if (!row) return { ok: false, reason: 'not_connected' };
  if (!row.isActive) return { ok: false, reason: 'reconnect' };
  if (!row.encryptedAccessToken || !row.encryptedRefreshToken || !row.externalAccountId) return { ok: false, reason: 'reconnect' };

  const expiresAt = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return { ok: true, accessToken: decryptSecret(row.encryptedAccessToken), folderId: row.externalAccountId };
  }

  const refreshed = await refreshDriveToken(decryptSecret(row.encryptedRefreshToken));
  if (!refreshed.ok) {
    logger.warn('[drive] token refresh failed', { organizationId, revoked: refreshed.revoked, error: refreshed.error });
    if (refreshed.revoked) {
      // The owner removed RoyalTrack from their Google account: show "Reconnect" rather than failing forever.
      await supabaseAdmin.from('TenantOAuthConnection').update({ isActive: false, updatedAt: new Date().toISOString() })
        .eq('organizationId', organizationId).eq('provider', PROVIDER);
      return { ok: false, reason: 'reconnect' };
    }
    return { ok: false, reason: 'unavailable' };
  }

  await supabaseAdmin
    .from('TenantOAuthConnection')
    .update({
      encryptedAccessToken: encryptSecret(refreshed.accessToken),
      tokenExpiresAt: new Date(refreshed.expiresAt).toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq('organizationId', organizationId)
    .eq('provider', PROVIDER);
  return { ok: true, accessToken: refreshed.accessToken, folderId: row.externalAccountId };
}
