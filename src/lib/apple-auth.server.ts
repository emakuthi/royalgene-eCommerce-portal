import 'server-only';
import { createHash, createPublicKey, type JsonWebKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import logger from './logger';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
/** Apple issues native sign-in tokens to the app's bundle id. */
const IOS_BUNDLE_ID = 'com.royalgenegroup.royaltrack';
const KEYS_MAX_AGE_MS = 60 * 60 * 1000;

type AppleKey = JsonWebKey & { kid?: string };
let cachedKeys: { keys: AppleKey[]; fetchedAt: number } | null = null;

async function fetchKeys(): Promise<AppleKey[]> {
  const response = await fetch(APPLE_KEYS_URL);
  if (!response.ok) throw new Error(`Apple keys request failed with ${response.status}`);
  const body = (await response.json()) as { keys?: AppleKey[] };
  const keys = body.keys ?? [];
  cachedKeys = { keys, fetchedAt: Date.now() };
  return keys;
}

/** Apple rotates its keys, so an unknown key id gets one fresh look before it's refused. */
async function keyFor(kid: string): Promise<AppleKey | undefined> {
  const fresh = cachedKeys && Date.now() - cachedKeys.fetchedAt < KEYS_MAX_AGE_MS;
  const known = fresh ? cachedKeys?.keys.find((key) => key.kid === kid) : undefined;
  return known ?? (await fetchKeys()).find((key) => key.kid === kid);
}

export interface VerifiedAppleUser {
  /** Apple's permanent id for this person within this app. */
  subject: string;
  /** Null when Apple left it out or hasn't verified it. Can be a private relay address. */
  email: string | null;
}

/**
 * Verifies an identity token against Apple's public keys, and that it was issued
 * for this app and this sign-in attempt. Returns null for anything that doesn't verify.
 */
export async function verifyAppleIdentityToken(identityToken: string, rawNonce: string): Promise<VerifiedAppleUser | null> {
  try {
    const kid = jwt.decode(identityToken, { complete: true })?.header.kid;
    if (!kid) return null;
    const key = await keyFor(kid);
    if (!key) return null;

    const publicKey = createPublicKey({ key, format: 'jwk' });
    const payload = jwt.verify(identityToken, publicKey, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: IOS_BUNDLE_ID,
    });
    if (typeof payload === 'string' || !payload.sub) return null;

    const expectedNonce = createHash('sha256').update(rawNonce).digest('hex');
    if (payload.nonce !== expectedNonce) return null;

    // Apple sends this claim as either a boolean or a string.
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    const email = typeof payload.email === 'string' && verified ? payload.email.trim().toLowerCase() : null;
    return { subject: payload.sub, email: email || null };
  } catch (err) {
    logger.warn('[apple-auth] Identity token verification failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
