/**
 * Split payments — one checkout paid with more than one method. See
 * supabase/migrations/20261008_01_payment_breakdown.sql for how it's stored.
 */
export interface PaymentPart {
  method: string;
  amount: number;
}

const MAX_PARTS = 5;

/**
 * Validates a client-sent breakdown. `null` = none sent (a single-method
 * sale); `{ error }` = sent but malformed, which the caller should reject
 * rather than silently record as single-method.
 */
export function parsePaymentBreakdown(input: unknown): PaymentPart[] | null | { error: string } {
  if (input == null) return null;
  if (!Array.isArray(input)) return { error: 'paymentBreakdown must be an array' };
  if (input.length < 2 || input.length > MAX_PARTS) {
    return { error: `paymentBreakdown needs between 2 and ${MAX_PARTS} methods` };
  }
  const parts: PaymentPart[] = [];
  const seen = new Set<string>();
  for (const p of input) {
    const method = typeof p?.method === 'string' ? p.method.trim() : '';
    const amount = typeof p?.amount === 'number' ? p.amount : Number(p?.amount);
    if (!method || method.length > 30) return { error: 'Each payment needs a method name' };
    if (!Number.isFinite(amount) || amount <= 0) return { error: `Invalid amount for ${method}` };
    const key = method.toLowerCase();
    if (seen.has(key)) return { error: `${method} is listed twice` };
    seen.add(key);
    parts.push({ method, amount: Math.round(amount * 100) / 100 });
  }
  return parts;
}

/** Every method a sale was paid with — the breakdown's methods, else its single paymentMethod. */
export function paymentMethodsOf(sale: { paymentMethod?: unknown; paymentBreakdown?: unknown }): string[] {
  const parsed = parsePaymentBreakdown(sale.paymentBreakdown);
  if (Array.isArray(parsed)) return parsed.map((p) => p.method);
  return [(typeof sale.paymentMethod === 'string' && sale.paymentMethod) || 'cash'];
}

/**
 * Normalises a method name to one of the known kinds. The app saves
 * "M-Pesa"/"Card"/"Cash", the portal "mobile_money"/"card"/"cash" — an
 * exact-match check on either spelling mislabels the other.
 */
export function paymentKind(method: string | null | undefined): 'cash' | 'mpesa' | 'card' {
  const m = (method ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (m === 'mpesa' || m === 'mobilemoney') return 'mpesa';
  if (m === 'card') return 'card';
  return 'cash';
}
