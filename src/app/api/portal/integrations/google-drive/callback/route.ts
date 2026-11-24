import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/accounting/oauth-state.server';
import { DRIVE_SCOPES, ensureFolder, exchangeDriveCode } from '@/lib/google-drive.server';
import { saveDriveConnection } from '@/lib/receipts/drive-connection.server';
import { RECEIPTS_ROOT_FOLDER } from '@/lib/receipts/receipts.server';
import { driveCallbackUrl } from '@/lib/receipts/drive-oauth-urls.server';
import { getOrganizationById } from '@/lib/organizations.server';
import { getOrgUrlFor } from '@/lib/urls';
import logger from '@/lib/logger';

const APP_MESSAGES: Record<string, { title: string; body: string }> = {
  connected: { title: 'Google Drive connected', body: 'Receipts you scan will now be saved in the "RoyalTrack Receipts" folder in your Drive.' },
  cancelled: { title: 'Not connected', body: 'You cancelled on the Google screen. Nothing was changed.' },
  no_drive_access: { title: 'Drive access was not given', body: 'Connect again and leave the Google Drive box ticked, so RoyalTrack can save receipts.' },
  error: { title: 'Google Drive was not connected', body: 'Something went wrong. Go back to the app and try again.' },
};

const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Where a connection started from the app ends: what happened, and a way back to the app. */
function appDonePage(status: string): Response {
  const m = APP_MESSAGES[status] ?? APP_MESSAGES.error;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(m.title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:360px;padding:32px 24px;text-align:center}h1{font-size:22px;margin:0 0 12px}p{color:#475569;line-height:1.5;margin:0 0 24px}
a{display:inline-block;background:#9333ea;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600}
small{display:block;margin-top:16px;color:#64748b}@media (prefers-color-scheme:dark){body{background:#0f172a;color:#f1f5f9}p,small{color:#94a3b8}}</style></head>
<body><main><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.body)}</p>
<a href="intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.royalgenegroup.royaltrack;end">Back to RoyalTrack</a>
<small>Or close this page.</small></main></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// GET /api/portal/integrations/google-drive/callback — Google sends the owner back here
// (always the default tenant's host, see drive-oauth-urls.server.ts). The signed state names
// the workspace; we save the connection, make the receipts folder, and send the browser
// back to that workspace's Settings → Integrations (or, when the app started it, to a page that says what
// happened and offers the way back to the app).
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const identity = verifyOAuthState(p.get('state') ?? '');
  const org = identity ? await getOrganizationById(identity.organizationId) : null;
  const back = (status: string) => identity?.app ? appDonePage(status) : NextResponse.redirect(
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
