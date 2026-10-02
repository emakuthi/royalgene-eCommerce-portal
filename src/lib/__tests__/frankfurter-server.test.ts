import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLatestRates } from '../frankfurter.server';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch);
}

describe('frankfurter.server / fetchLatestRates', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('parses valid base→target rates', async () => {
    mockFetchOnce({ base: 'KES', date: '2026-10-02', rates: { USD: 0.0077, EUR: 0.0071 } });
    const r = await fetchLatestRates('KES', ['USD', 'EUR']);
    expect(r).not.toBeNull();
    expect(r!.base).toBe('KES');
    expect(r!.date).toBe('2026-10-02');
    expect(r!.rates.USD).toBeCloseTo(0.0077);
  });

  it('drops zero/negative/non-numeric rates (never stores invalid data)', async () => {
    mockFetchOnce({ base: 'KES', date: '2026-10-02', rates: { USD: 0.0077, EUR: 0, GBP: -1, UGX: 'x' } });
    const r = await fetchLatestRates('KES', ['USD', 'EUR', 'GBP', 'UGX']);
    expect(Object.keys(r!.rates)).toEqual(['USD']);
  });

  it('returns null on a non-OK response (fallback path)', async () => {
    mockFetchOnce({}, false, 503);
    expect(await fetchLatestRates('KES', ['USD'])).toBeNull();
  });

  it('returns null when the API throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch);
    expect(await fetchLatestRates('KES', ['USD'])).toBeNull();
  });

  it('short-circuits when only the base is requested', async () => {
    const r = await fetchLatestRates('KES', ['KES']);
    expect(r!.rates).toEqual({});
  });
});
