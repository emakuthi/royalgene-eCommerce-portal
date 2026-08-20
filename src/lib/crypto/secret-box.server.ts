import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-layer AES-256-GCM for secrets that must never sit in the DB as
 * plaintext (M-Pesa/future-integration API credentials). Deliberately NOT
 * fail-soft like paystack.server.ts/resend-client.ts — a missing or
 * malformed key throws immediately, so a misconfigured deployment can never
 * silently persist a plaintext secret. Callers (the API routes) turn that
 * throw into a clear 503, not a crash.
 *
 * CREDENTIALS_ENCRYPTION_KEY must be a 32-byte key, base64-encoded
 * (generate with `openssl rand -base64 32`).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set — cannot encrypt or decrypt stored credentials');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (generate with `openssl rand -base64 32`)');
  }
  return key;
}

/** Returns base64(iv || authTag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < IV_LENGTH + 16) {
    throw new Error('Malformed encrypted secret payload');
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Encrypts a JSON-serializable object as a single blob (used for grouped secrets like M-Pesa's consumerKey/consumerSecret/passkey). */
export function encryptJson<T>(value: T): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(encoded: string): T {
  return JSON.parse(decryptSecret(encoded)) as T;
}
