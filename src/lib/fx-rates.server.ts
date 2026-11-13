import 'server-only';
import logger from './logger';

/**
 * Thin backend client for ExchangeRate-API's open access endpoint (no key
 * required, updated daily). Chosen over Frankfurter because Frankfurter only
 * carries the ECB's ~30 currencies — no KES, UGX, TZS or RWF — so a KES-based
 * sync always got 404. Its free terms ask for a "Rates by ExchangeRate-API"
 * credit wherever the rates are shown (see CurrencyRatesPanel). All calls
 * happen server-side only. Rates are validated (finite, > 0) before being
 * returned so bad/null data can never reach the database.
 *
 *   GET https://open.er-api.com/v6/latest/KES
 *   → { result: "success", base_code: "KES", time_last_update_unix: 1763078400, rates: { USD: 0.00769, ... } }
 *
 * The returned `rates[X]` means "how many X per 1 base" (i.e. base→X).
 */
const BASE_URL = process.env.FX_RATES_BASE_URL || 'https://open.er-api.com/v6';

export interface FxRates {
  base: string;
  date: string; // YYYY-MM-DD (the day the provider last updated its rates, UTC)
  rates: Record<string, number>; // base→target, only the requested targets
}

export async function fetchLatestRates(base: string, symbols: string[]): Promise<FxRates | null> {
  const from = base.toUpperCase();
  const targets = symbols.map((s) => s.toUpperCase()).filter((s) => s !== from);
  if (targets.length === 0) return { base: from, date: new Date().toISOString().slice(0, 10), rates: {} };

  const url = `${BASE_URL}/latest/${encodeURIComponent(from)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn('Exchange-rate request failed', { status: res.status, url });
      return null;
    }
    const json = (await res.json()) as {
      result?: string;
      'error-type'?: string;
      base_code?: string;
      time_last_update_unix?: number;
      rates?: Record<string, unknown>;
    };
    if (json?.result !== 'success') {
      logger.warn('Exchange-rate service returned an error', { url, error: json?.['error-type'] });
      return null;
    }
    const rawRates = json.rates ?? {};
    const rates: Record<string, number> = {};
    for (const code of targets) {
      const n = Number(rawRates[code]);
      if (Number.isFinite(n) && n > 0) rates[code] = n; // skip missing/null/≤0 — never store invalid
    }
    if (Object.keys(rates).length === 0) {
      logger.warn('Exchange-rate service returned no valid rates', { url, targets });
      return null;
    }
    const updated = typeof json.time_last_update_unix === 'number' ? new Date(json.time_last_update_unix * 1000) : new Date();
    return {
      base: (json.base_code || from).toUpperCase(),
      date: updated.toISOString().slice(0, 10),
      rates,
    };
  } catch (err) {
    logger.warn('Exchange-rate fetch error', { error: err instanceof Error ? err.message : String(err), url });
    return null;
  }
}
