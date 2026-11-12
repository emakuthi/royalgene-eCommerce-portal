import { paymentKind, parsePaymentBreakdown } from './payment-breakdown';
import { formatMoney } from './currency';

/**
 * The owner's end-of-day summary (sent to WhatsApp by daily-report.server.ts).
 * Pure: takes the day's rows, returns the numbers and the template's text
 * parameters, so it can be tested without a database.
 */

export interface ReportSale {
  shopId: string;
  saleGroupId: string | null;
  id: string;
  totalAmount: number | string;
  paymentMethod?: string | null;
  paymentBreakdown?: unknown;
  deletedAt?: string | null;
}

export interface ReportStock {
  quantity: number | string;
  lowStockThreshold: number | string | null;
}

export interface DailyReport {
  total: number;
  orders: number;
  byPayment: { cash: number; mpesa: number; card: number; credit: number };
  shops: Array<{ name: string; total: number; orders: number }>;
  outOfStock: number;
  lowStock: number;
  deletedSales: number;
}

export function summariseDay(
  sales: ReportSale[],
  shopNames: Record<string, string>,
  stock: ReportStock[],
): DailyReport {
  const live = sales.filter((s) => !s.deletedAt);
  const byPayment = { cash: 0, mpesa: 0, card: 0, credit: 0 };
  const perShop = new Map<string, { total: number; groups: Set<string> }>();

  for (const s of live) {
    const amount = Number(s.totalAmount) || 0;
    // A split payment's breakdown covers the whole checkout and repeats on every
    // line, so each line is split by the methods' shares rather than summed.
    const parts = parsePaymentBreakdown(s.paymentBreakdown);
    if (Array.isArray(parts)) {
      const whole = parts.reduce((t, p) => t + p.amount, 0);
      for (const p of parts) byPayment[paymentKind(p.method)] += whole > 0 ? (amount * p.amount) / whole : 0;
    } else {
      byPayment[paymentKind(s.paymentMethod)] += amount;
    }
    const shop = perShop.get(s.shopId) ?? { total: 0, groups: new Set<string>() };
    shop.total += amount;
    shop.groups.add(s.saleGroupId || s.id);
    perShop.set(s.shopId, shop);
  }

  const shops = [...perShop.entries()]
    .map(([id, v]) => ({ name: shopNames[id] ?? 'Shop', total: v.total, orders: v.groups.size }))
    .sort((a, b) => b.total - a.total);

  let outOfStock = 0;
  let lowStock = 0;
  for (const row of stock) {
    const q = Number(row.quantity) || 0;
    const limit = Number(row.lowStockThreshold) || 0;
    if (q <= 0) outOfStock++;
    else if (limit > 0 && q <= limit) lowStock++;
  }

  return {
    total: live.reduce((t, s) => t + (Number(s.totalAmount) || 0), 0),
    orders: new Set(live.map((s) => s.saleGroupId || s.id)).size,
    byPayment,
    shops,
    outOfStock,
    lowStock,
    deletedSales: new Set(sales.filter((s) => s.deletedAt).map((s) => s.saleGroupId || s.id)).size,
  };
}

/**
 * The WhatsApp template's 7 body parameters, in order:
 * business, date, total, orders, payments, shops, stock and deletions.
 * WhatsApp rejects newlines and tabs inside a parameter, so lists are joined with " · ".
 */
export function reportTemplateParams(
  report: DailyReport,
  businessName: string,
  dateLabel: string,
  currency: string,
): string[] {
  const money = (n: number) => formatMoney(n, currency, { decimals: 0 });
  const label = { mpesa: 'M-Pesa', cash: 'Cash', card: 'Card', credit: 'On credit' } as const;
  const payments = (['mpesa', 'cash', 'card', 'credit'] as const)
    .filter((k) => report.byPayment[k] > 0)
    .map((k) => `${label[k]} ${money(report.byPayment[k])}`)
    .join(' · ') || 'none';
  const shops = report.shops.length
    ? report.shops.map((s) => `${s.name} ${money(s.total)} (${s.orders})`).join(' · ')
    : 'no sales';
  const stock = [
    report.outOfStock ? `${report.outOfStock} out of stock` : '',
    report.lowStock ? `${report.lowStock} running low` : '',
    report.deletedSales ? `${report.deletedSales} of today's sales deleted` : '',
  ].filter(Boolean).join(' · ') || 'all good';
  return [businessName, dateLabel, money(report.total), String(report.orders), payments, shops, stock]
    .map((p) => p.replace(/\s+/g, ' ').trim().slice(0, 1000));
}

/**
 * A WhatsApp number in international form without "+" (what the Cloud API
 * takes). Kenyan local numbers ("0712…", "0112…") get the 254 prefix.
 * Returns null when it can't be a phone number.
 */
export function normaliseWhatsappNumber(raw: string): string | null {
  let digits = raw.replace(/[\s\-()+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (/^0[17]\d{8}$/.test(digits)) digits = `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}
