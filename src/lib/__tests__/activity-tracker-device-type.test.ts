import { describe, it, expect } from 'vitest';
import { detectDeviceType } from '../activity-tracker';

describe('detectDeviceType', () => {
  it('trusts source="mobile" over the user-agent — the Android app sends no custom UA, just OkHttp\'s bare default', () => {
    expect(detectDeviceType('okhttp/4.12.0', 'mobile')).toBe('mobile');
    expect(detectDeviceType(null, 'mobile')).toBe('mobile');
    expect(detectDeviceType(undefined, 'mobile')).toBe('mobile');
  });

  it('falls back to user-agent sniffing for web/portal sources, unchanged from before', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'web')).toBe('mobile');
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120', 'portal')).toBe('desktop');
    expect(detectDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'web')).toBe('tablet');
    expect(detectDeviceType(null, 'web')).toBe('api');
    expect(detectDeviceType('curl/8.4.0', 'web')).toBe('api');
  });

  it('still sniffs the user-agent when no source is given at all', () => {
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120')).toBe('desktop');
  });
});
