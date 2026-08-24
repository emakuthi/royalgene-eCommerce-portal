import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import logger from './logger';

/**
 * GOOGLE_OAUTH_CLIENT_IDS is a comma-separated list — Android's legacy
 * GoogleSignIn API requires requesting an ID token using the *Web* client
 * ID (not the Android one), so in practice this only ever needs one value,
 * but a list keeps the door open for a future web sign-in flow using its
 * own client ID without code changes here.
 */
const CLIENT_IDS = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Only the web flow (portal) does a server-side authorization-code exchange
// and needs a client secret; mobile's native GoogleSignIn only ever hands
// this backend an already-issued ID token to verify.
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

export function isGoogleSignInConfigured(): boolean {
  return CLIENT_IDS.length > 0;
}

export function isGoogleWebSignInConfigured(): boolean {
  return CLIENT_IDS.length > 0 && Boolean(CLIENT_SECRET);
}

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  if (!client) client = new OAuth2Client();
  return client;
}

export interface VerifiedGoogleUser {
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Verifies a Google-issued ID token directly against Google's own public
 * keys — never touches Supabase Auth (this app has no Supabase Auth
 * session concept anywhere; the JWTs this app issues are its own,
 * signed with JWT_SECRET). Returns null for anything that doesn't verify:
 * wrong signature, expired, or an audience not in GOOGLE_OAUTH_CLIENT_IDS.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser | null> {
  if (!isGoogleSignInConfigured()) {
    logger.warn('[google-auth] GOOGLE_OAUTH_CLIENT_IDS not configured — rejecting Google sign-in attempt');
    return null;
  }

  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience: CLIENT_IDS });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) return null;

    return {
      email: payload.email.toLowerCase(),
      name: payload.name ?? null,
      emailVerified: payload.email_verified === true,
    };
  } catch (err) {
    logger.warn('[google-auth] ID token verification failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Exchanges an authorization code (portal's browser-redirect OAuth flow)
 * for tokens, then verifies the returned ID token the same way as
 * verifyGoogleIdToken. `redirectUri` must exactly match both what was sent
 * to Google's consent screen and what's registered in the Google Cloud
 * Console for this client ID.
 */
export async function exchangeGoogleAuthCode(code: string, redirectUri: string): Promise<VerifiedGoogleUser | null> {
  if (!isGoogleWebSignInConfigured()) {
    logger.warn('[google-auth] GOOGLE_OAUTH_CLIENT_SECRET not configured — rejecting Google web sign-in attempt');
    return null;
  }

  try {
    const exchangeClient = new OAuth2Client(CLIENT_IDS[0], CLIENT_SECRET, redirectUri);
    const { tokens } = await exchangeClient.getToken(code);
    if (!tokens.id_token) return null;

    const ticket = await exchangeClient.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_IDS });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) return null;

    return {
      email: payload.email.toLowerCase(),
      name: payload.name ?? null,
      emailVerified: payload.email_verified === true,
    };
  } catch (err) {
    logger.warn('[google-auth] Authorization code exchange failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
