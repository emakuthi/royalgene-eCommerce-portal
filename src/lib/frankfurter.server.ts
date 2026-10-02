import 'server-only';
import logger from './logger';

/**
 * Thin backend client for the Frankfurter FX API (no key required). All
 * external calls happen server-side only — never from the browser. Rates are
 * validated (finite, > 0) before being returned so bad/null data can never
 * reach the database.
 *
 *   GET https://api.frankfurter.dev/v1/latest?base=KES&symbols=USD,EUR,...
 *   → { amount: 1, base: "KES", date: "2026-10-02", rates: { USD: 0.0077, ... } }
 *
 * The returned `rates[X]` means "how many X per 1 base" (i.e. base→X).
 */
const BASE_URL = process.env.FRANKFURTER_BASE_URL || 'https://api.frankfurter.dev/v1';

export interface FrankfurterRates {
  base: string;
  date: string; // YYYY-MM-DD (the rate date Frankfurter reports)
  rates: Record<string, number>; // base→target
}

export async function fetchLatestRates(base: string, symbols: string[]): Promise<FrankfurterRates | null> {
  const targets = symbols.map((s) => s.toUpperCase()).filter((s) => s !== base.toUpperCase());
  if (targets.length === 0) return { base: base.toUpperCase(), date: new Date().toISOString().slice(0, 10), rates: {} };

  const url = `${BASE_URL}/latest?base=${encodeURIComponent(base.toUpperCase())}&symbols=${encodeURIComponent(targets.join(','))}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn('Frankfurter request failed', { status: res.status, url });
      return null;
    }
    const json = (await res.json()) as { base?: string; date?: string; rates?: Record<string, unknown> };
    const rawRates = json?.rates ?? {};
    const rates: Record<string, number> = {};
    for (const [code, val] of Object.entries(rawRates)) {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) rates[code.toUpperCase()] = n; // drop any null/≤0 — never store invalid
    }
    if (Object.keys(rates).length === 0) {
      logger.warn('Frankfurter returned no valid rates', { url, raw: json });
      return null;
    }
    return {
      base: (json.base || base).toUpperCase(),
      date: json.date || new Date().toISOString().slice(0, 10),
      rates,
    };
  } catch (err) {
    logger.warn('Frankfurter fetch error', { error: err instanceof Error ? err.message : String(err), url });
    return null;
  }
}
