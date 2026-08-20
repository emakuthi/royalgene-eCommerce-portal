import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Binds an OAuth `state` param to the initiating tenant without a DB table
 * — this app's auth is Bearer-JWT-in-header (localStorage, no cookies), so
 * the browser's top-level navigation to Intuit's consent screen and back
 * carries no Authorization header. HMAC-signed + short-lived, reusing the
 * existing JWT_SECRET (same one src/lib/auth.server.ts signs portal tokens
 * with) rather than introducing a second secret.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a user to complete the Intuit consent screen

interface OAuthStatePayload {
  organizationId: string;
  userId: string;
  exp: number;
}

function getSecret(): string {
  return process.env.JWT_SECRET || 'dev_jwt_secret';
}

export function signOAuthState(organizationId: string, userId: string): string {
  const payload: OAuthStatePayload = { organizationId, userId, exp: Date.now() + STATE_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(state: string): { organizationId: string; userId: string } | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;

  const expected = createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (payload.exp < Date.now()) return null;
    return { organizationId: payload.organizationId, userId: payload.userId };
  } catch {
    return null;
  }
}
