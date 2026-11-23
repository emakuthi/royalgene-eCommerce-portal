import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import logger from './logger';

/**
 * Google Drive calls for purchase receipts. Uses the portal's web OAuth client
 * (GOOGLE_OAUTH_CLIENT_IDS[0] + GOOGLE_OAUTH_CLIENT_SECRET, the same one as
 * "Sign in with Google") with the narrow `drive.file` scope: RoyalTrack can
 * only see files and folders it created itself, never the rest of the Drive.
 */

export const DRIVE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];

const CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',')[0]?.trim() ?? '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export function isDriveConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function oauthClient(redirectUri?: string): OAuth2Client {
  return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri);
}

/** Google's consent screen. `offline` + `consent` so a refresh token always comes back. */
export function driveAuthUrl(redirectUri: string, state: string): string {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: DRIVE_SCOPES,
    state,
  });
}

export interface DriveTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
  grantedScopes: string[];
}

export async function exchangeDriveCode(code: string, redirectUri: string): Promise<{ ok: true; data: DriveTokens } | { ok: false; error: string }> {
  try {
    const client = oauthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) return { ok: false, error: 'No access token' };
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
      email = ticket.getPayload()?.email?.toLowerCase() ?? null;
    }
    return {
      ok: true,
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ?? Date.now() + 3500 * 1000,
        email,
        grantedScopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `revoked` means the owner removed access (or the token died): the connection has to be made again. */
export async function refreshDriveToken(refreshToken: string): Promise<{ ok: true; accessToken: string; expiresAt: number } | { ok: false; revoked: boolean; error: string }> {
  try {
    const client = oauthClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) return { ok: false, revoked: false, error: 'No access token' };
    return { ok: true, accessToken: credentials.access_token, expiresAt: credentials.expiry_date ?? Date.now() + 3500 * 1000 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, revoked: /invalid_grant/i.test(message), error: message };
  }
}

/** Best effort: tells Google to drop the grant when the owner disconnects. */
export async function revokeDriveToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (err) {
    logger.warn('[drive] revoke failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export class DriveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function driveFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveError(`Drive ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The folder called `name` under `parentId` (or My Drive's root) that RoyalTrack made, creating it if needed. */
export async function ensureFolder(accessToken: string, name: string, parentId?: string | null): Promise<string> {
  const q = [`name = ${quote(name)}`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', parentId ? `${quote(parentId)} in parents` : null]
    .filter(Boolean).join(' and ');
  const found = await driveFetch(accessToken, `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&spaces=drive`);
  const existing = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (existing) return existing;

  const created = await driveFetch(accessToken, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return ((await created.json()) as { id: string }).id;
}

/** True while the folder still exists and isn't in the bin. */
export async function folderIsLive(accessToken: string, folderId: string): Promise<boolean> {
  try {
    const res = await driveFetch(accessToken, `${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=trashed`);
    return !((await res.json()) as { trashed?: boolean }).trashed;
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return false;
    throw err;
  }
}

export async function uploadFile(
  accessToken: string,
  file: { name: string; mimeType: string; parentId: string; bytes: Uint8Array; description?: string },
): Promise<{ id: string; webViewLink: string | null }> {
  const boundary = `rt${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({ name: file.name, parents: [file.parentId], ...(file.description ? { description: file.description } : {}) });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const res = await driveFetch(accessToken, `${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.from(file.bytes), tail]),
  });
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return { id: json.id, webViewLink: json.webViewLink ?? null };
}

/** The file's bytes as a streaming response; a 404 means it was deleted in Drive. */
export async function downloadFile(accessToken: string, fileId: string): Promise<Response> {
  return driveFetch(accessToken, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
}

/** Moves the file to the Drive bin (recoverable there for 30 days), never deletes outright. */
export async function trashFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(accessToken, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}
