import 'server-only';
import { getRate, getCurrencies } from './exchange-rates.server';

export interface ConversionResult {
  amount: number;        // converted amount, rounded to the target's decimals
  from: string;
  to: string;
  rate: number;          // the from→to rate used
  rateDate: string;      // the date the conversion used
  decimals: number;      // target currency decimals
}

function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Convert an amount between currencies. When `date` is supplied the historical
 * rate for that date is used (so re-pricing an old transaction is stable);
 * otherwise today's rate. Per-tenant overrides apply when `organizationId` is
 * given. Returns null when no rate can be resolved (caller decides whether
 * that's fatal — most display paths should degrade gracefully).
 *
 *   convert(100, 'USD', 'KES')            → ~12,950 KES
 *   convert(12950, 'KES', 'USD')          → ~100 USD   (reverse)
 *   convert(amount, from, to, { date })   → historical
 */
export async function convert(
  amount: number,
  from: string,
  to: string,
  opts: { date?: string; organizationId?: string | null } = {},
): Promise<ConversionResult | null> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const rate = await getRate(f, t, opts);
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;

  const currencies = await getCurrencies();
  const decimals = currencies.find((c) => c.code.toUpperCase() === t)?.decimals ?? 2;

  return {
    amount: roundTo(amount * rate, decimals),
    from: f,
    to: t,
    rate,
    rateDate: opts.date || new Date().toISOString().slice(0, 10),
    decimals,
  };
}
