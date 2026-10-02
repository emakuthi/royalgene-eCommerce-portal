// Per-tenant currency formatting (Option A: amounts are stored in the tenant's
// base currency; we only change the symbol/label). The optional USD rate drives
// a display-only "≈ $" approximation — it never converts stored data.

export const DEFAULT_CURRENCY = 'KES';

/** Common symbols; falls back to the ISO code itself for anything not listed. */
const SYMBOLS: Record<string, string> = {
  KES: 'Ksh', USD: '$', EUR: '€', GBP: '£', NGN: '₦',
  TZS: 'TSh', UGX: 'USh', ZAR: 'R', GHS: '₵', RWF: 'FRw', INR: '₹',
};

export function currencySymbol(code?: string | null): string {
  const c = (code || DEFAULT_CURRENCY).toUpperCase();
  return SYMBOLS[c] ?? c;
}

/** Format a MAJOR-unit amount (already divided out of cents by the caller) with the tenant symbol. */
export function formatMoney(amount: number, currency?: string | null, opts?: { decimals?: number }): string {
  const decimals = opts?.decimals ?? 2;
  const n = Number.isFinite(amount) ? amount : 0;
  const formatted = n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${currencySymbol(currency)} ${formatted}`;
}

/**
 * Display-only USD approximation for a base-currency amount. Returns null when
 * no label should be shown (currency already USD, or no positive rate set).
 */
export function approxUsd(amount: number, currency?: string | null, usdRate?: number | null): string | null {
  const rate = typeof usdRate === 'number' ? usdRate : Number(usdRate);
  if (!rate || rate <= 0) return null;
  if ((currency || DEFAULT_CURRENCY).toUpperCase() === 'USD') return null;
  const usd = (Number.isFinite(amount) ? amount : 0) / rate;
  return `≈ $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
