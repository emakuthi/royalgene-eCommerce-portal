import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLatestRates } from '../fx-rates.server';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (_url: string) => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

// 2026-11-13 00:00:00 UTC
const UPDATED = 1794528000;

describe('fx-rates.server / fetchLatestRates', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks for the base currency and keeps only the requested targets', async () => {
    const fn = mockFetchOnce({ result: 'success', base_code: 'KES', time_last_update_unix: UPDATED, rates: { KES: 1, USD: 0.00769, EUR: 0.006936, JPY: 1.19 } });
    const r = await fetchLatestRates('kes', ['USD', 'EUR']);
    expect(String(fn.mock.calls[0][0])).toMatch(/\/latest\/KES$/);
    expect(r!.base).toBe('KES');
    expect(r!.date).toBe('2026-11-13');
    expect(r!.rates).toEqual({ USD: 0.00769, EUR: 0.006936 });
  });

  it('covers East African currencies (the reason for leaving Frankfurter)', async () => {
    mockFetchOnce({ result: 'success', base_code: 'KES', time_last_update_unix: UPDATED, rates: { UGX: 31.6, TZS: 20.4, RWF: 11.4 } });
    const r = await fetchLatestRates('KES', ['UGX', 'TZS', 'RWF']);
    expect(Object.keys(r!.rates).sort()).toEqual(['RWF', 'TZS', 'UGX']);
  });

  it('drops missing, zero, negative and non-numeric rates (never stores invalid data)', async () => {
    mockFetchOnce({ result: 'success', base_code: 'KES', rates: { USD: 0.0077, EUR: 0, GBP: -1, UGX: 'x' } });
    const r = await fetchLatestRates('KES', ['USD', 'EUR', 'GBP', 'UGX', 'XYZ']);
    expect(Object.keys(r!.rates)).toEqual(['USD']);
  });

  it('returns null when the service reports an error', async () => {
    mockFetchOnce({ result: 'error', 'error-type': 'unsupported-code' });
    expect(await fetchLatestRates('KES', ['USD'])).toBeNull();
  });

  it('returns null on a non-OK response', async () => {
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
