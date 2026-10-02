import { formatMoney } from './currency';

/**
 * Tenant-currency formatters — use these for customer/shop money (sales,
 * inventory, analytics, dashboards). Pass the tenant currency from
 * useBranding().branding.currency (client) or getOrgCurrency (server). The
 * formatKES* helpers below stay KES-only and are for BILLING (Paystack charges
 * in KES regardless of the tenant's display currency).
 */
export function formatMoneyMajor(amount: number | undefined | null, currency?: string | null): string {
  return formatMoney(Number(amount ?? 0), currency);
}

export function formatMoneyFromCents(cents: number | undefined | null, currency?: string | null): string {
  return formatMoney(Number(cents ?? 0) / 100, currency);
}

export function formatKESFromCents(cents: number | undefined | null): string {
  const v = Number(cents ?? 0);
  const major = v / 100;
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(major);
  } catch (e) {
    // Fallback
    return `KES ${major.toFixed(2)}`;
  }
}

export function formatKESMajor(amount: number | undefined | null): string {
  // If amount is already in major units (not cents)
  const v = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(v);
  } catch (e) {
    return `KES ${v.toFixed(2)}`;
  }
}
