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
}

/** Standardized JWT signing helper — every signing site should use this. */
export function signAuthToken(payload: AuthTokenPayload, opts?: { expiresInSeconds?: number }) {
  const expiresIn = opts?.expiresInSeconds ?? 60 * 60 * 24 * 7;
  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string | null | undefined): VerifiedPayload | null {
  if (!token) return null;
  try {
	const raw = jwt.verify(token, JWT_SECRET) as unknown;
	if (typeof raw !== 'object' || raw === null) return null;
	const obj = raw as Record<string, unknown>;
	const maybeUserId = typeof obj.userId === 'string' ? obj.userId : (typeof obj.id === 'string' ? obj.id : undefined);
	if (!maybeUserId) return null;
	const result: VerifiedPayload = { userId: maybeUserId };
	if (typeof obj.role === 'string') result.role = obj.role;
	Object.keys(obj).forEach((k) => { if (k !== 'userId') result[k] = obj[k]; });
	return result;
  } catch (err) {
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


