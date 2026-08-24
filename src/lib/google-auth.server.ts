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

export function isGoogleSignInConfigured(): boolean {
  return CLIENT_IDS.length > 0;
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
