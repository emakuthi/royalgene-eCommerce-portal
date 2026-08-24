import 'server-only';
import logger from './logger';

const APP_ID = process.env.FACEBOOK_APP_ID ?? '';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? '';

export function isFacebookSignInConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET);
}

export interface VerifiedFacebookUser {
  email: string;
  name: string | null;
}

interface FacebookDebugTokenResponse {
  data?: { app_id?: string; is_valid?: boolean; user_id?: string; error?: { message?: string } };
}

interface FacebookMeResponse {
  id?: string;
  name?: string;
  email?: string;
  error?: { message?: string };
}

/**
 * Verifies a Facebook access token directly against the Graph API — two
 * calls, matching Facebook's own recommended server-side verification
 * flow: debug_token confirms the token was actually issued for *this*
 * app (app_id match) and is still valid, then /me fetches the profile.
 * Facebook's Graph API has no separate "email_verified" flag the way
 * Google's ID token does — an email present here already went through
 * Facebook's own account verification to exist on the account at all.
 */
export async function verifyFacebookAccessToken(accessToken: string): Promise<VerifiedFacebookUser | null> {
  if (!isFacebookSignInConfigured()) {
    logger.warn('[facebook-auth] FACEBOOK_APP_ID/FACEBOOK_APP_SECRET not configured — rejecting Facebook sign-in attempt');
    return null;
  }

  try {
    const appAccessToken = `${APP_ID}|${APP_SECRET}`;
    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`,
    );
    const debugJson = (await debugRes.json()) as FacebookDebugTokenResponse;

    if (!debugRes.ok || !debugJson.data?.is_valid || debugJson.data.app_id !== APP_ID) {
      logger.warn('[facebook-auth] Token failed debug_token validation', {
        status: debugRes.status,
        error: debugJson.data?.error?.message,
      });
      return null;
    }

    const meRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    const meJson = (await meRes.json()) as FacebookMeResponse;

    if (!meRes.ok || !meJson.email) {
      logger.warn('[facebook-auth] /me lookup failed or returned no email', { status: meRes.status, error: meJson.error?.message });
      return null;
    }

    return { email: meJson.email.toLowerCase(), name: meJson.name ?? null };
  } catch (err) {
    logger.warn('[facebook-auth] Access token verification failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
