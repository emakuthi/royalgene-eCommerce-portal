import { describe, it, expect } from 'vitest';
import { scrubDeep, scrubString } from '../faro-scrub';

describe('faro-scrub', () => {
  it('drops query strings and fragments from URLs and paths', () => {
    expect(scrubString('https://royaltrack.royalgenegroup.co.ke/verify-email?token=abc')).toBe(
      'https://royaltrack.royalgenegroup.co.ke/verify-email',
    );
    expect(scrubString('https://shop1.royaltrack.royalgenegroup.co.ke/session-bridge#access_token=eyJx')).toBe(
      'https://shop1.royaltrack.royalgenegroup.co.ke/session-bridge',
    );
    expect(scrubString('/api/portal/sales?shopId=1&page=2')).toBe('/api/portal/sales');
    expect(scrubString('/api/webhooks/mpesa/s3cret')).toBe('/api/webhooks/mpesa/:token');
  });

  it('scrubs secrets inside free text without dropping the rest', () => {
    expect(scrubString('redirect to app#access_token=abc&refresh_token=def')).toBe(
      'redirect to app#access_token=<redacted>&refresh_token=<redacted>',
    );
    expect(scrubString('GET reset?code=123456 failed')).toBe('GET reset?code=<redacted> failed');
    expect(scrubString('auth Bearer abcdefghijkl rejected')).toBe('auth Bearer <redacted> rejected');
    expect(scrubString('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 bad')).toBe('jwt <redacted-jwt> bad');
    expect(scrubString('TypeError: x is undefined')).toBe('TypeError: x is undefined');
  });

  it('walks nested payloads such as OTLP span attributes', () => {
    const item = {
      meta: { page: { url: 'https://royaltrack.royalgenegroup.co.ke/login?email=a%40b.co' } },
      payload: {
        attributes: [{ key: 'http.url', value: { stringValue: 'https://royaltrack.royalgenegroup.co.ke/api/x?token=t' } }],
        duration: 12,
        ok: true,
      },
    };
    expect(scrubDeep(item)).toEqual({
      meta: { page: { url: 'https://royaltrack.royalgenegroup.co.ke/login' } },
      payload: {
        attributes: [{ key: 'http.url', value: { stringValue: 'https://royaltrack.royalgenegroup.co.ke/api/x' } }],
        duration: 12,
        ok: true,
      },
    });
  });
});
