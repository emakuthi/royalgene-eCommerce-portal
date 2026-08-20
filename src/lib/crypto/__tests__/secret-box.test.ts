import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, encryptJson, decryptJson } from '../secret-box.server';

const ORIGINAL_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;

describe('secret-box', () => {
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a plaintext secret', () => {
    const ciphertext = encryptSecret('my-consumer-secret');
    expect(ciphertext).not.toContain('my-consumer-secret');
    expect(decryptSecret(ciphertext)).toBe('my-consumer-secret');
  });

  it('round-trips a JSON object', () => {
    const payload = { consumerKey: 'ck', consumerSecret: 'cs', passkey: 'pk' };
    const ciphertext = encryptJson(payload);
    expect(decryptJson(ciphertext)).toEqual(payload);
  });

  it('throws when CREDENTIALS_ENCRYPTION_KEY is missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('throws when CREDENTIALS_ENCRYPTION_KEY is the wrong length', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encryptSecret('secret-value');
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a byte in the ciphertext
    expect(() => decryptSecret(buf.toString('base64'))).toThrow();
  });
});
