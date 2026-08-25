import 'server-only';
import logger from './logger';

const APP_ID = process.env.FACEBOOK_APP_ID ?? '';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? '';

export function isFacebookSignInConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET);
}

/**
 * The mobile app's browser-redirect OAuth flow uses this fixed custom-scheme
 * URI as its redirect_uri (Facebook's documented convention for native apps
 * without the SDK: fb<APP_ID>://authorize). The code-exchange call must pass
 * back the exact same value, so both sides derive it from the same APP_ID
 * rather than the client sending it (nothing to spoof).
 */
export function getFacebookNativeRedirectUri(): string {
  return `fb${APP_ID}://authorize`;
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

interface FacebookCodeExchangeResponse {
  access_token?: string;
  error?: { message?: string };
}

/**
 * Exchanges an authorization code (portal's browser-redirect OAuth flow,
 * response_type=code) for a user access token. `redirectUri` must exactly
 * match both what was sent to Facebook's dialog and what's registered as a
 * valid OAuth redirect URI for this app.
 */
export async function exchangeFacebookAuthCode(code: string, redirectUri: string): Promise<string | null> {
  if (!isFacebookSignInConfigured()) {
    logger.warn('[facebook-auth] FACEBOOK_APP_ID/FACEBOOK_APP_SECRET not configured — rejecting Facebook web sign-in attempt');
    return null;
  }

  try {
    const url =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${encodeURIComponent(APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${encodeURIComponent(APP_SECRET)}` +
      `&code=${encodeURIComponent(code)}`;
    const res = await fetch(url);
    const json = (await res.json()) as FacebookCodeExchangeResponse;

    if (!res.ok || !json.access_token) {
      logger.warn('[facebook-auth] Authorization code exchange failed', { status: res.status, error: json.error?.message });
      return null;
    }
    return json.access_token;
  } catch (err) {
    logger.warn('[facebook-auth] Authorization code exchange request failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
