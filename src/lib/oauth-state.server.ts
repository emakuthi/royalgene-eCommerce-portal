import 'server-only';
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF-nonce + tenant-context cookies shared by every provider's start/
 * callback route pair (Google, Facebook). Both routes for a given provider
 * always run on the same fixed host (the default tenant's), so these never
 * need to cross subdomains — only the final post-login redirect to
 * session-bridge does that, via a plain URL, same as signup already does.
 */
const STATE_COOKIE = 'oauth_state';
const ORG_COOKIE = 'oauth_org';
const COOKIE_MAX_AGE_SECONDS = 600;

export function issueOAuthState(hostOrgId: string | null): { nonce: string; applyTo: (res: NextResponse) => void } {
  const nonce = randomBytes(24).toString('hex');
  return {
    nonce,
    applyTo: (res: NextResponse) => {
      const opts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: COOKIE_MAX_AGE_SECONDS,
        path: '/',
      };
      res.cookies.set(STATE_COOKIE, nonce, opts);
      res.cookies.set(ORG_COOKIE, hostOrgId ?? '', opts);
    },
  };
}

export function consumeOAuthState(request: NextRequest, stateParam: string | null): { valid: boolean; hostOrgId: string | null } {
  const cookieNonce = request.cookies.get(STATE_COOKIE)?.value ?? null;
  const cookieOrg = request.cookies.get(ORG_COOKIE)?.value ?? '';
  const valid = Boolean(stateParam) && Boolean(cookieNonce) && stateParam === cookieNonce;
  return { valid, hostOrgId: cookieOrg || null };
}

export function clearOAuthState(res: NextResponse) {
  res.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
  res.cookies.set(ORG_COOKIE, '', { maxAge: 0, path: '/' });
}
