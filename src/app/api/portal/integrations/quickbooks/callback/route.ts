import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/accounting/quickbooks.server';
import { verifyOAuthState } from '@/lib/accounting/oauth-state.server';
import { saveQuickBooksConnection } from '@/lib/integrations/quickbooks-connection.server';
import logger from '@/lib/logger';

// GET /api/portal/integrations/quickbooks/callback — Intuit redirects the browser here after
// consent. No Authorization header is available (top-level navigation) — the signed `state`
// param (see oauth-state.server.ts) is what identifies which tenant/user initiated this.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const realmId = request.nextUrl.searchParams.get('realmId');
  const errorParam = request.nextUrl.searchParams.get('error');

  const redirectTo = (status: 'connected' | 'error') =>
    NextResponse.redirect(new URL(`/settings?tab=integrations&qb=${status}`, request.url));

  if (errorParam || !code || !state || !realmId) {
    logger.warn('[quickbooks] callback missing params or denied', { errorParam, hasCode: Boolean(code), hasState: Boolean(state), hasRealmId: Boolean(realmId) });
    return redirectTo('error');
  }

  const identity = verifyOAuthState(state);
  if (!identity) {
    logger.warn('[quickbooks] callback state verification failed');
    return redirectTo('error');
  }

  const redirectUri = `${request.nextUrl.origin}/api/portal/integrations/quickbooks/callback`;
  const tokenResult = await exchangeCodeForTokens(code, redirectUri);
  if (!tokenResult.ok) {
    logger.warn('[quickbooks] token exchange failed', { error: tokenResult.error });
    return redirectTo('error');
  }

  try {
    await saveQuickBooksConnection(identity.organizationId, {
      realmId,
      accessToken: tokenResult.data.access_token,
      refreshToken: tokenResult.data.refresh_token,
      expiresInSeconds: tokenResult.data.expires_in,
      connectedBy: identity.userId,
    });
  } catch (err) {
    logger.error('[quickbooks] failed to save connection', { error: err instanceof Error ? err.message : String(err) });
    return redirectTo('error');
  }

  return redirectTo('connected');
}
