import { paymentKind, parsePaymentBreakdown } from './payment-breakdown';

/**
 * Credit sales (deni). A checkout can be paid fully on credit or partly
 * (e.g. Cash 500 + Credit 1,500); either way the sale names the customer who
 * owes it. A balance is never stored: it's the credit part of the customer's
 * live sales minus their live payments, so deleting or editing a sale fixes
 * it on its own. Pure, so it runs the same on the server and in tests.
 */

export interface CreditSaleLine {
  id: string;
  customerId?: string | null;
  totalAmount: number | string;
  /** Tenant base amount; preferred over totalAmount when the sale was in another currency. */
  baseAmount?: number | string | null;
  paymentMethod?: string | null;
  paymentBreakdown?: unknown;
  deletedAt?: string | null;
}

export interface CreditPaymentRow {
  customerId: string;
  amount: number | string;
  deletedAt?: string | null;
}

/** The line's amount in the tenant base currency. */
function lineAmount(sale: CreditSaleLine): number {
  const base = sale.baseAmount == null ? NaN : Number(sale.baseAmount);
  return Number.isFinite(base) ? base : Number(sale.totalAmount) || 0;
}

/**
 * How much of this sale line is owed. A split payment's breakdown covers the
 * whole checkout and repeats on every line, so the line takes credit's share.
 */
export function creditPart(sale: CreditSaleLine): number {
  const amount = lineAmount(sale);
  const parts = parsePaymentBreakdown(sale.paymentBreakdown);
  if (Array.isArray(parts)) {
    const whole = parts.reduce((t, p) => t + p.amount, 0);
    const credit = parts.filter((p) => paymentKind(p.method) === 'credit').reduce((t, p) => t + p.amount, 0);
    return whole > 0 ? round2((amount * credit) / whole) : 0;
  }
  return paymentKind(sale.paymentMethod) === 'credit' ? round2(amount) : 0;
}

/** True when any of the sale is on credit (the sale must then name a customer). */
export function isCreditSale(sale: { paymentMethod?: string | null; paymentBreakdown?: unknown }): boolean {
  const parts = parsePaymentBreakdown(sale.paymentBreakdown);
  if (Array.isArray(parts)) return parts.some((p) => paymentKind(p.method) === 'credit');
  return paymentKind(sale.paymentMethod) === 'credit';
}

export interface CustomerBalance {
  customerId: string;
  /** Total ever sold on credit. */
  owedTotal: number;
  /** Total ever paid back. */
  paidTotal: number;
  /** What they still owe; negative = paid in advance. */
  balance: number;
}

/** Balances for every customer that appears in either list. Deleted rows don't count. */
export function customerBalances(sales: CreditSaleLine[], payments: CreditPaymentRow[]): Map<string, CustomerBalance> {
  const out = new Map<string, CustomerBalance>();
  const get = (id: string) => {
    let b = out.get(id);
    if (!b) out.set(id, (b = { customerId: id, owedTotal: 0, paidTotal: 0, balance: 0 }));
    return b;
  };
  for (const s of sales) {
    if (s.deletedAt || !s.customerId) continue;
    const owed = creditPart(s);
    if (owed > 0) get(s.customerId).owedTotal += owed;
  }
  for (const p of payments) {
    if (p.deletedAt) continue;
    get(p.customerId).paidTotal += Number(p.amount) || 0;
  }
  for (const b of out.values()) {
    b.owedTotal = round2(b.owedTotal);
    b.paidTotal = round2(b.paidTotal);
    b.balance = round2(b.owedTotal - b.paidTotal);
  }
  return out;
}

/** Customer name: trimmed, single-spaced, 2–80 characters; null when not usable. */
export function cleanCustomerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

/** Optional phone as typed: digits, spaces, +, -, brackets; "" → null; undefined when invalid. */
export function cleanCustomerPhone(raw: unknown): string | null | undefined {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const phone = raw.trim();
  if (!phone) return null;
  return /^[+\d][\d\s\-()]{6,19}$/.test(phone) ? phone : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
