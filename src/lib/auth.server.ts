import 'server-only';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import logger from './logger';

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
  /** See AuthTokenPayload.deviceId. */
  deviceId?: string | null;
  [k: string]: unknown;
};

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

/**
 * @deprecated Use signAuthToken() with an explicit AuthTokenPayload instead.
 * Kept for call sites not yet migrated — accepts an arbitrary object and
 * signs it as-is, which is how the payload shape became inconsistent across
 * signing sites in the first place.
 */
export function generateToken(user: unknown, opts?: { expiresInSeconds?: number }) {
  const expiresIn = opts?.expiresInSeconds ?? 60 * 60 * 24 * 7;
  const payload = (typeof user === 'object' && user !== null) ? (user as Record<string, unknown>) : { data: user };
  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, { expiresIn });
}

export interface AuthTokenPayload {
  userId: string;
  /** null only for role === 'super_admin' (a platform-level, cross-tenant role) */
  organizationId: string | null;
  email: string;
  role: 'customer' | 'admin' | 'super_admin' | 'portal_user';
  shopId?: string | null;
  /**
   * The mobile app's stable per-install id, when this token was issued to
   * the app (mobile login/register/signup/social-auth) — absent for web
   * portal tokens. Lets verifyMobileShopAccess/verifyMobileAuth reject a
   * request whose device has been remotely revoked (see
   * src/lib/device-registry.server.ts) without making the shared,
   * synchronous verifyToken() do a DB read.
   */
  deviceId?: string | null;
}

/** Standardized JWT signing helper — every signing site should use this. */
export function signAuthToken(payload: AuthTokenPayload, opts?: { expiresInSeconds?: number }) {
  const expiresIn = opts?.expiresInSeconds ?? 60 * 60 * 24 * 7;
  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, { expiresIn });
}

/**
 * How long an app-issued token (one carrying a deviceId claim — see
 * AuthTokenPayload.deviceId) is still accepted after it expires. Builds up to
 * 1.0.222 can't renew their token (their refresh path called a Supabase auth
 * flow this backend never used), so after 7 days every phone silently
 * stopped syncing and queued sales were eventually rolled back. Within this
 * window the app keeps working and newer builds swap the token for a fresh
 * one via POST /api/mobile/auth/refresh. Web portal tokens never get it.
 */
export const MOBILE_TOKEN_GRACE_SECONDS = 60 * 60 * 24 * 30;

function toVerifiedPayload(raw: unknown): VerifiedPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const maybeUserId = typeof obj.userId === 'string' ? obj.userId : (typeof obj.id === 'string' ? obj.id : undefined);
  if (!maybeUserId) return null;
  const result: VerifiedPayload = { userId: maybeUserId };
  if (typeof obj.role === 'string') result.role = obj.role;
  Object.keys(obj).forEach((k) => { if (k !== 'userId') result[k] = obj[k]; });
  return result;
}

export function verifyToken(token: string | null | undefined): VerifiedPayload | null {
  if (!token) return null;
  try {
	return toVerifiedPayload(jwt.verify(token, JWT_SECRET));
  } catch (err) {
	if (err instanceof jwt.TokenExpiredError) {
	  try {
		// Signature still checked — only the expiry is relaxed, and only for app tokens.
		const raw = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as Record<string, unknown>;
		const exp = typeof raw?.exp === 'number' ? raw.exp : 0;
		if ('deviceId' in raw && Date.now() / 1000 - exp < MOBILE_TOKEN_GRACE_SECONDS) {
		  const payload = toVerifiedPayload(raw);
		  if (payload) payload.expiredWithinGrace = true;
		  return payload;
		}
	  } catch { /* fall through to the warning below */ }
	}
	logger.warn('verifyToken failed', { err });
	return null;
  }
}


export function extractTokenFromHeader(headerValue: string | null | undefined) {
  if (!headerValue) return null;
  const parts = headerValue.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePasswords(plain: string, hashed: string) {
  try {
	let normalizedHashed = hashed.trim();
	normalizedHashed = normalizedHashed.replace(/\r/g, '').replace(/\n/g, '').replace(/[\x00-\x1F\x7F]/g, '');
	if ((normalizedHashed.startsWith('\"') && normalizedHashed.endsWith('\"')) || (normalizedHashed.startsWith("'") && normalizedHashed.endsWith("'"))) {
	  normalizedHashed = normalizedHashed.slice(1, -1);
	}

	const ok = await bcrypt.compare(plain, normalizedHashed as string);
	if (ok) return true;
	if (plain === normalizedHashed) return true;
	if (normalizedHashed.startsWith('$2y$')) {
	  const alt = '$2a$' + normalizedHashed.slice(4);
	  try { if (await bcrypt.compare(plain, alt)) return true; } catch (err) { logger.warn('comparePasswords: normalized bcrypt compare failed', { err }); }
	}
	if (normalizedHashed !== hashed) {
	  try { if (await bcrypt.compare(plain, normalizedHashed)) return true; } catch (err) { /* ignore */ }
	}
	return false;
  } catch (err) {
	logger.warn('comparePasswords error', { err });
	return false;
  }
}

export function generate2FASecret() { return authenticator.generateSecret(); }

export async function generate2FAQRCode(email?: string, secret?: string) {
  // Dynamically import qrcode on-demand to avoid loading it in environments
  // that don't need it. Cast to a specific shape to avoid `any`.
  const qrcodeMod = (await import('qrcode')) as unknown as { toDataURL: (s: string) => Promise<string> };
  const acct = email || 'user';
  const otpauth = authenticator.keyuri(acct, 'RoyalGene', secret || authenticator.generateSecret());
  try {
	return await qrcodeMod.toDataURL(otpauth);
  } catch (err) {
	return otpauth;
  }
}

export function verify2FAToken(code: string, secret: string) {
  try { return authenticator.check(code, secret); } catch (err) { return false; }
}


