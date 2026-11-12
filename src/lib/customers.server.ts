import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';
import { idempotentInsert } from './sync/idempotent-insert.server';
import { isValidClientId } from './sync/syncable-entities';
import type { VerifiedPayload } from './auth.server';
import { hasCapability } from './permissions.server';
import {
  cleanCustomerName, cleanCustomerPhone, creditPart, customerBalances, isCreditSale,
  type CreditPaymentRow, type CreditSaleLine,
} from './credit';
import { paymentKind } from './payment-breakdown';

/**
 * Credit customers (deni) and their repayments — shared by the portal and
 * mobile routes. See lib/credit.ts for how a balance is worked out.
 *
 * `shopIds` scopes what a caller sees, the same way sales are scoped
 * (shop-access.server.ts): null = every shop; otherwise only credit sales
 * made in, and payments received at, those shops count.
 */

const PAGE = 1000;

export interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPaymentRow {
  id: string;
  customerId: string;
  shopId: string;
  amount: number;
  method: string;
  note: string | null;
  receivedBy: string | null;
  receivedAt: string;
  createdAt: string;
}

export interface CustomerSummary extends CustomerRow {
  owedTotal: number;
  paidTotal: number;
  balance: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code: string };
const fail = (status: number, error: string, code = 'VALIDATION_ERROR') => ({ ok: false as const, status, error, code });

/** Every live credit sale line in the org (optionally only some customers / shops). */
async function creditSaleLines(orgId: string, opts: { customerId?: string; shopIds?: string[] | null }) {
  const rows: Array<CreditSaleLine & Record<string, unknown>> = [];
  if (opts.shopIds && opts.shopIds.length === 0) return rows;
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from('SalesEntry')
      .select('id, customerId, shopId, productId, saleGroupId, quantity, totalAmount, baseAmount, currency, paymentMethod, paymentBreakdown, createdAt, deletedAt')
      .eq('organizationId', orgId)
      .not('customerId', 'is', null)
      .is('deletedAt', null)
      .order('createdAt', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.customerId) q = q.eq('customerId', opts.customerId);
    if (opts.shopIds) q = q.in('shopId', opts.shopIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<CreditSaleLine & Record<string, unknown>>));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function livePayments(orgId: string, opts: { customerId?: string; shopIds?: string[] | null }) {
  const rows: CustomerPaymentRow[] = [];
  if (opts.shopIds && opts.shopIds.length === 0) return rows;
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from('CustomerPayment')
      .select('id, customerId, shopId, amount, method, note, receivedBy, receivedAt, createdAt')
      .eq('organizationId', orgId)
      .is('deletedAt', null)
      .order('receivedAt', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.customerId) q = q.eq('customerId', opts.customerId);
    if (opts.shopIds) q = q.in('shopId', opts.shopIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as CustomerPaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) })));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Customers with what each owes, biggest debt first. */
export async function listCustomers(orgId: string, shopIds: string[] | null): Promise<CustomerSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('Customer')
    .select('id, organizationId, name, phone, notes, createdAt, updatedAt')
    .eq('organizationId', orgId)
    .is('deletedAt', null)
    .order('name', { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  const [sales, payments] = await Promise.all([creditSaleLines(orgId, { shopIds }), livePayments(orgId, { shopIds })]);
  const balances = customerBalances(sales, payments as CreditPaymentRow[]);
  return ((data ?? []) as CustomerRow[])
    .map((c) => {
      const b = balances.get(c.id);
      return { ...c, owedTotal: b?.owedTotal ?? 0, paidTotal: b?.paidTotal ?? 0, balance: b?.balance ?? 0 };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

export interface CustomerCreditSale {
  /** saleGroupId, or the line id for a single-line sale. */
  id: string;
  shopId: string;
  soldAt: string;
  total: number;
  onCredit: number;
  items: number;
}

/** One customer: their credit sales (one row per checkout), payments and balance. */
export async function getCustomer(orgId: string, customerId: string, shopIds: string[] | null) {
  const { data: customer } = await supabaseAdmin
    .from('Customer')
    .select('id, organizationId, name, phone, notes, createdAt, updatedAt')
    .eq('organizationId', orgId)
    .eq('id', customerId)
    .is('deletedAt', null)
    .maybeSingle();
  if (!customer) return null;
  const [lines, payments] = await Promise.all([
    creditSaleLines(orgId, { customerId, shopIds }),
    livePayments(orgId, { customerId, shopIds }),
  ]);
  const sales = new Map<string, CustomerCreditSale>();
  for (const l of lines) {
    const key = (l.saleGroupId as string | null) || l.id;
    const s = sales.get(key) ?? {
      id: key,
      shopId: l.shopId as string,
      soldAt: l.createdAt as string,
      total: 0,
      onCredit: 0,
      items: 0,
    };
    s.total += Number(l.baseAmount ?? l.totalAmount) || 0;
    s.onCredit += creditPart(l);
    s.items += 1;
    sales.set(key, s);
  }
  const b = customerBalances(lines, payments as CreditPaymentRow[]).get(customerId);
  return {
    customer: customer as CustomerRow,
    owedTotal: b?.owedTotal ?? 0,
    paidTotal: b?.paidTotal ?? 0,
    balance: b?.balance ?? 0,
    sales: [...sales.values()].map((s) => ({ ...s, total: round2(s.total), onCredit: round2(s.onCredit) })),
    payments,
  };
}

export async function createCustomer(
  orgId: string,
  input: { id?: unknown; name?: unknown; phone?: unknown; notes?: unknown },
  createdBy: string | null,
): Promise<Result<CustomerRow>> {
  const name = cleanCustomerName(input.name);
  if (!name) return fail(400, 'Enter the customer\'s name (at least 2 letters)');
  const phone = cleanCustomerPhone(input.phone);
  if (phone === undefined) return fail(400, 'That phone number doesn\'t look right');
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) || null : null;
  const id = isValidClientId(input.id) ? input.id : uuidv4();

  const insert = await idempotentInsert<CustomerRow & { organizationId: string }>('Customer', {
    id, organizationId: orgId, name, phone, notes, createdBy,
  });
  if (!insert.ok) {
    logger.error('[customers] create failed', { orgId, error: insert.error });
    return fail(500, 'Could not add the customer', 'INTERNAL_ERROR');
  }
  // A retried request whose id belongs to another workspace must not leak it.
  if (insert.row.organizationId !== orgId) return fail(409, 'That customer id is already taken', 'CONFLICT');
  return { ok: true, data: insert.row };
}

export async function updateCustomer(
  orgId: string,
  customerId: string,
  input: { name?: unknown; phone?: unknown; notes?: unknown },
): Promise<Result<CustomerRow>> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanCustomerName(input.name);
    if (!name) return fail(400, 'Enter the customer\'s name (at least 2 letters)');
    patch.name = name;
  }
  if (input.phone !== undefined) {
    const phone = cleanCustomerPhone(input.phone);
    if (phone === undefined) return fail(400, 'That phone number doesn\'t look right');
    patch.phone = phone;
  }
  if (input.notes !== undefined) {
    patch.notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) || null : null;
  }
  if (Object.keys(patch).length === 0) return fail(400, 'Nothing to change');
  const { data, error } = await supabaseAdmin
    .from('Customer')
    .update(patch)
    .eq('organizationId', orgId)
    .eq('id', customerId)
    .is('deletedAt', null)
    .select('id, organizationId, name, phone, notes, createdAt, updatedAt')
    .maybeSingle();
  if (error) return fail(500, 'Could not save the customer', 'INTERNAL_ERROR');
  if (!data) return fail(404, 'Customer not found', 'NOT_FOUND');
  return { ok: true, data: data as CustomerRow };
}

/** Removes a customer from the list. Refused while they still owe (or are owed) money. */
export async function deleteCustomer(orgId: string, customerId: string): Promise<Result<{ id: string }>> {
  const detail = await getCustomer(orgId, customerId, null);
  if (!detail) return fail(404, 'Customer not found', 'NOT_FOUND');
  if (Math.abs(detail.balance) >= 0.01) {
    return fail(409, `${detail.customer.name} still has a balance. Settle it before removing them.`, 'HAS_BALANCE');
  }
  const { error } = await supabaseAdmin
    .from('Customer')
    .update({ deletedAt: new Date().toISOString() })
    .eq('organizationId', orgId)
    .eq('id', customerId);
  if (error) return fail(500, 'Could not remove the customer', 'INTERNAL_ERROR');
  return { ok: true, data: { id: customerId } };
}

/** Is this a live customer of this workspace? (A sale on credit must name one.) */
export async function customerExists(orgId: string, customerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Customer')
    .select('id')
    .eq('organizationId', orgId)
    .eq('id', customerId)
    .is('deletedAt', null)
    .maybeSingle();
  return !!data;
}

/**
 * Records money a customer paid towards what they owe. Paying more than the
 * balance is allowed (it shows as credit in their favour) — the shop has the
 * cash in hand either way.
 */
export async function recordCustomerPayment(
  orgId: string,
  customerId: string,
  input: { id?: unknown; shopId?: unknown; amount?: unknown; method?: unknown; note?: unknown; receivedAt?: unknown },
  receivedBy: string | null,
): Promise<Result<CustomerPaymentRow>> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return fail(400, 'Enter how much they paid');
  if (amount > 100_000_000) return fail(400, 'That amount is too large');
  const shopId = typeof input.shopId === 'string' ? input.shopId : '';
  if (!shopId) return fail(400, 'Pick the shop that received the payment');
  const kind = paymentKind(typeof input.method === 'string' ? input.method : 'cash');
  if (kind === 'credit') return fail(400, 'A repayment must be cash, M-Pesa or card');
  const method = kind === 'mpesa' ? 'M-Pesa' : kind === 'card' ? 'Card' : 'Cash';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) || null : null;
  const receivedAt = parseWhen(input.receivedAt);

  if (!(await customerExists(orgId, customerId))) return fail(404, 'Customer not found', 'NOT_FOUND');
  const { data: shop } = await supabaseAdmin.from('Shop').select('id').eq('id', shopId).eq('organizationId', orgId).maybeSingle();
  if (!shop) return fail(400, 'Shop not found');

  const id = isValidClientId(input.id) ? input.id : uuidv4();
  const insert = await idempotentInsert<CustomerPaymentRow & { organizationId: string }>('CustomerPayment', {
    id, organizationId: orgId, customerId, shopId, amount, method, note, receivedBy, receivedAt,
  });
  if (!insert.ok) {
    logger.error('[customers] payment failed', { orgId, customerId, error: insert.error });
    return fail(500, 'Could not record the payment', 'INTERNAL_ERROR');
  }
  if (insert.row.organizationId !== orgId) return fail(409, 'That payment id is already taken', 'CONFLICT');
  return { ok: true, data: { ...insert.row, amount: Number(insert.row.amount) } };
}

/** Undo a payment recorded by mistake (admin only — enforced by the routes). */
export async function deleteCustomerPayment(orgId: string, paymentId: string): Promise<Result<{ id: string }>> {
  const { data, error } = await supabaseAdmin
    .from('CustomerPayment')
    .update({ deletedAt: new Date().toISOString() })
    .eq('organizationId', orgId)
    .eq('id', paymentId)
    .is('deletedAt', null)
    .select('id')
    .maybeSingle();
  if (error) return fail(500, 'Could not remove the payment', 'INTERNAL_ERROR');
  if (!data) return fail(404, 'Payment not found', 'NOT_FOUND');
  return { ok: true, data: { id: paymentId } };
}

/** A client-sent time no later than now (an offline payment keeps when it happened); else now. */
function parseWhen(raw: unknown): string {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  const now = Date.now();
  if (!Number.isFinite(t) || t > now + 5 * 60_000 || t < now - 90 * 86_400_000) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The customer a new sale line is linked to. A sale with any credit in it
 * must name a live customer, and the caller must be allowed to sell on
 * credit; a fully paid sale may name one too (it then shows in their history).
 * Returns the customer, null for none, or the error to send back.
 */
export async function resolveSaleCustomer(
  payload: VerifiedPayload,
  orgId: string,
  sale: { customerId?: unknown; paymentMethod?: string | null; paymentBreakdown?: unknown },
): Promise<{ ok: true; customer: { id: string; name: string; phone: string | null } | null } | { ok: false; status: number; error: string; code: string }> {
  const credit = isCreditSale(sale);
  const raw = sale.customerId;
  if (raw != null && raw !== '' && !isValidClientId(raw)) return fail(400, 'Invalid customer');
  const customerId = isValidClientId(raw) ? raw : null;
  if (credit && !customerId) return fail(400, 'Pick the customer this sale is on credit to', 'CUSTOMER_REQUIRED');
  if (credit && !(await hasCapability(payload, 'sell_on_credit'))) {
    return fail(403, 'You are not allowed to sell on credit. Ask the business owner to allow it.', 'FORBIDDEN');
  }
  if (!customerId) return { ok: true, customer: null };
  const { data } = await supabaseAdmin
    .from('Customer')
    .select('id, name, phone')
    .eq('organizationId', orgId)
    .eq('id', customerId)
    .is('deletedAt', null)
    .maybeSingle();
  if (!data) {
    return credit
      ? fail(400, 'That customer was not found. They may have been removed.', 'CUSTOMER_NOT_FOUND')
      : { ok: true, customer: null };
  }
  return { ok: true, customer: data as { id: string; name: string; phone: string | null } };
}

/**
 * For a sale edit that changes the payment method or the customer: checks the
 * result like a new sale (credit needs a customer and the permission) and
 * returns the body to hand to applySaleEdit, with customerId resolved. Edits
 * that touch neither pass through unchanged.
 */
export async function checkSaleEditCustomer(
  payload: VerifiedPayload,
  sale: Record<string, unknown> & { organizationId: string },
  body: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string; code: string }> {
  const changesMethod = typeof body.paymentMethod === 'string' && body.paymentMethod !== '';
  if (!changesMethod && body.customerId === undefined) return { ok: true, body };
  const resolved = await resolveSaleCustomer(payload, sale.organizationId, {
    customerId: body.customerId !== undefined ? body.customerId : sale.customerId,
    // Re-picking the method replaces a split (see applySaleEdit), so the split no longer counts.
    paymentMethod: changesMethod ? (body.paymentMethod as string) : (sale.paymentMethod as string | null),
    paymentBreakdown: changesMethod ? undefined : sale.paymentBreakdown,
  });
  if (!resolved.ok) return resolved;
  return { ok: true, body: { ...body, customerId: resolved.customer?.id ?? null } };
}
