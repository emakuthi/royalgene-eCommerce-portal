// Client-safe auth helpers. Do not import node-only modules here.
export type TokenUser = {
  id?: string;
  userId?: string;
  email?: string;
  role?: string;
  exp?: number;
  [k: string]: unknown;
};

export type VerifiedPayload = {
  userId: string;
  role?: string;
  organizationId?: string | null;
  shopId?: string | null;
  [k: string]: unknown;
};

export function isJwtToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.split('.').length === 3;
}

function safeBase64Decode(str: string): string {
  // Replace URL-safe characters
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '='
  while (str.length % 4 !== 0) str += '=';
  try {
    return decodeURIComponent(Array.prototype.map.call(atob(str), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  } catch (e) {
    // Fall back to simple atob
    try { return atob(str); } catch (_) { return '';} 
  }
}

export function decodeJwt(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const json = safeBase64Decode(payload);
    const obj = JSON.parse(json);
    return obj as Record<string, unknown>;
  } catch (e) {
    return null;
  }
}

export function verifyToken(token: string | null | undefined): VerifiedPayload | null {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  const maybeUserId = typeof decoded.userId === 'string' ? decoded.userId : (typeof decoded.id === 'string' ? decoded.id : undefined);
  if (!maybeUserId) return null;
  const result: VerifiedPayload = { userId: maybeUserId };
  if (typeof decoded.role === 'string') result.role = decoded.role;
  // copy remaining known keys
  Object.keys(decoded).forEach((k) => { if (k !== 'userId') result[k] = decoded[k]; });
  return result;
}

export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const decoded = decodeJwt(token) as Record<string, unknown> | null;
    if (!decoded) return false;
    const exp = decoded.exp;
    if (typeof exp !== 'number') return false;
    const now = Math.floor(Date.now() / 1000);
    return exp <= now;
  } catch (e) {
    return false;
  }
}

export function extractTokenFromHeader(headerValue: string | null | undefined) {
  if (!headerValue) return null;
  const parts = headerValue.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

