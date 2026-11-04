import { createHash, generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAppleIdentityToken } from '../apple-auth.server';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NONCE = 'raw-nonce';
const hashed = createHash('sha256').update(NONCE).digest('hex');

function token(claims: Record<string, unknown> = {}, options: jwt.SignOptions = {}) {
  return jwt.sign(
    { nonce: hashed, email: 'Owner@Example.com', email_verified: 'true', ...claims },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: 'key-1',
      issuer: 'https://appleid.apple.com',
      audience: 'com.royalgenegroup.royaltrack',
      subject: 'apple-sub-1',
      expiresIn: '5m',
      ...options,
    },
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key-1' }] }),
  })));
});

describe('verifyAppleIdentityToken', () => {
  it('accepts a good token and lowercases the email', async () => {
    await expect(verifyAppleIdentityToken(token(), NONCE)).resolves.toEqual({
      subject: 'apple-sub-1',
      email: 'owner@example.com',
    });
  });

  it('accepts email_verified sent as a boolean', async () => {
    const result = await verifyAppleIdentityToken(token({ email_verified: true }), NONCE);
    expect(result?.email).toBe('owner@example.com');
  });

  it('keeps the person but drops an email Apple has not verified', async () => {
    const result = await verifyAppleIdentityToken(token({ email_verified: 'false' }), NONCE);
    expect(result).toEqual({ subject: 'apple-sub-1', email: null });
  });

  it('copes with a token that has no email', async () => {
    const result = await verifyAppleIdentityToken(token({ email: undefined, email_verified: undefined }), NONCE);
    expect(result).toEqual({ subject: 'apple-sub-1', email: null });
  });

  it('refuses a token from another sign-in attempt', async () => {
    await expect(verifyAppleIdentityToken(token(), 'other-nonce')).resolves.toBeNull();
  });

  it('refuses a token issued for another app', async () => {
    await expect(verifyAppleIdentityToken(token({}, { audience: 'com.other.app' }), NONCE)).resolves.toBeNull();
  });

  it('refuses a token from another issuer', async () => {
    await expect(verifyAppleIdentityToken(token({}, { issuer: 'https://example.com' }), NONCE)).resolves.toBeNull();
  });

  it('refuses an expired token', async () => {
    await expect(verifyAppleIdentityToken(token({}, { expiresIn: -10 }), NONCE)).resolves.toBeNull();
  });

  it('refuses a token signed with a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ nonce: hashed, email: 'owner@example.com', email_verified: 'true' }, other, {
      algorithm: 'RS256',
      keyid: 'key-1',
      issuer: 'https://appleid.apple.com',
      audience: 'com.royalgenegroup.royaltrack',
      subject: 'apple-sub-1',
      expiresIn: '5m',
    });
    await expect(verifyAppleIdentityToken(forged, NONCE)).resolves.toBeNull();
  });

  it('refuses an unknown key id', async () => {
    await expect(verifyAppleIdentityToken(token({}, { keyid: 'key-2' }), NONCE)).resolves.toBeNull();
  });

  it('refuses a token Apple keys cannot be fetched for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(verifyAppleIdentityToken(token({}, { keyid: 'key-3' }), NONCE)).resolves.toBeNull();
  });
});
