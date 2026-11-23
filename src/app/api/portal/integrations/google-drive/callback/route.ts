import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/accounting/oauth-state.server';
import { DRIVE_SCOPES, ensureFolder, exchangeDriveCode } from '@/lib/google-drive.server';
import { saveDriveConnection } from '@/lib/receipts/drive-connection.server';
import { RECEIPTS_ROOT_FOLDER } from '@/lib/receipts/receipts.server';
import { driveCallbackUrl } from '@/lib/receipts/drive-oauth-urls.server';
import { getOrganizationById } from '@/lib/organizations.server';
import { getOrgUrlFor } from '@/lib/urls';
import logger from '@/lib/logger';

// GET /api/portal/integrations/google-drive/callback — Google sends the owner back here
// (always the default tenant's host, see drive-oauth-urls.server.ts). The signed state names
// the workspace; we save the connection, make the receipts folder, and send the browser
// back to that workspace's Settings → Integrations.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const identity = verifyOAuthState(p.get('state') ?? '');
  const org = identity ? await getOrganizationById(identity.organizationId) : null;
  const back = (status: string) => NextResponse.redirect(
    org ? getOrgUrlFor(org, `/settings?tab=integrations&drive=${status}`) : new URL(`/settings?tab=integrations&drive=${status}`, request.url),
  );

  const code = p.get('code');
  if (!identity || !org) {
    logger.warn('[drive] callback with a bad or expired state');
    return back('error');
  }
  if (p.get('error') || !code) return back(p.get('error') === 'access_denied' ? 'cancelled' : 'error');

  const tokens = await exchangeDriveCode(code, driveCallbackUrl());
  if (!tokens.ok) {
    logger.warn('[drive] code exchange failed', { error: tokens.error });
    return back('error');
  }
  // The owner can untick Drive on Google's consent screen; without it nothing would upload.
  if (!tokens.data.grantedScopes.includes(DRIVE_SCOPES[2])) return back('no_drive_access');
  if (!tokens.data.refreshToken) {
    logger.warn('[drive] no refresh token returned', { organizationId: org.id });
    return back('error');
  }

  try {
    const folderId = await ensureFolder(tokens.data.accessToken, RECEIPTS_ROOT_FOLDER);
    await saveDriveConnection(org.id, {
      accessToken: tokens.data.accessToken,
      refreshToken: tokens.data.refreshToken,
      expiresAt: tokens.data.expiresAt,
      email: tokens.data.email,
      folderId,
      connectedBy: identity.userId,
    });
  } catch (err) {
    logger.error('[drive] saving the connection failed', { organizationId: org.id, error: err instanceof Error ? err.message : String(err) });
    return back('error');
  }
  return back('connected');
}
