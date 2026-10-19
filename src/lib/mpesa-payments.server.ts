import 'server-only';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from './supabase-client';
import { getMpesaClientForOrganization } from './mpesa';
import { getMpesaConfigSummary } from './integrations/tenant-integration-config.server';
import { ROOT_DOMAIN } from './tenant';
import logger from './logger';

// M-Pesa STK push for shop sales: the till sends a payment prompt to the
// customer's phone, the customer enters their PIN, and Safaricom reports the
// result to /api/webhooks/mpesa/<callbackToken>. The app polls the payment
// until it settles, then saves the sale with the M-Pesa receipt number. The
// money goes straight to the workspace's own Paybill/Till.
//
// Safaricom's callback is unsigned, so each payment gets an unguessable
// callback token, and only a still-open payment can be settled by it.

export type MpesaPaymentStatus = 'pending' | 'success' | 'failed' | 'cancelled';

export interface MpesaPayment {
  id: string;
  organizationId: string;
  shopId: string | null;
  phone: string;
  amount: number;
  status: MpesaPaymentStatus;
  resultCode: number | null;
  resultDesc: string | null;
  mpesaReceipt: string | null;
  checkoutRequestId: string | null;
  createdAt: string;
}

const SELECT = 'id, organizationId, shopId, phone, amount, status, resultCode, resultDesc, mpesaReceipt, checkoutRequestId, createdAt';
/** Ask Safaricom directly once a prompt has had this long without a callback. */
const QUERY_AFTER_MS = 20_000;
/** A prompt on the phone times out after about a minute; past this, give up waiting. */
const EXPIRE_AFTER_MS = 3 * 60_000;
/** Safaricom result code for "the customer cancelled the prompt". */
const CANCELLED_BY_USER = 1032;

/** 07XX…, 01XX…, +2547…, 2547… → 2547XXXXXXXX; null if it isn't a Kenyan mobile number. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.startsWith('254') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}

export async function isMpesaEnabled(organizationId: string): Promise<boolean> {
  const summary = await getMpesaConfigSummary(organizationId);
  return Boolean(summary?.isActive);
}

export type StartResult =
  | { ok: true; payment: MpesaPayment; message: string }
  | { ok: false; status: number; code: string; error: string };

export async function startStkPayment(input: {
  organizationId: string;
  shopId: string | null;
  requestedBy: string | null;
  phone: string;
  amount: number;
  description?: string;
}): Promise<StartResult> {
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) return { ok: false, status: 400, code: 'INVALID_PHONE', error: 'Enter a Safaricom number like 0712 345 678.' };
  const amount = Math.ceil(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 1) return { ok: false, status: 400, code: 'INVALID_AMOUNT', error: 'The amount must be at least KES 1.' };

  const callbackToken = randomBytes(24).toString('hex');
  const client = await getMpesaClientForOrganization(input.organizationId, `https://${ROOT_DOMAIN}/api/webhooks/mpesa/${callbackToken}`);
  if (!client) {
    return { ok: false, status: 409, code: 'MPESA_NOT_CONFIGURED', error: 'M-Pesa isn\'t set up for this workspace yet. An admin can add the Paybill/Till keys in Settings → Integrations.' };
  }

  const { data: row, error } = await supabaseAdmin
    .from('MpesaPayment')
    .insert([{ organizationId: input.organizationId, shopId: input.shopId, requestedBy: input.requestedBy, phone, amount, callbackToken }])
    .select(SELECT)
    .single();
  if (error || !row) throw new Error(error?.message || 'Could not record the M-Pesa payment');
  const payment = row as MpesaPayment;

  const push = await client.initiateStkPush({
    phoneNumber: phone,
    amount,
    accountReference: payment.id,
    transactionDescription: input.description || 'Payment',
  });
  if (!push.success || !push.checkoutRequestId) {
    await settle(payment.id, { status: 'failed', resultDesc: push.error || push.message || 'M-Pesa refused the request' });
    return { ok: false, status: 502, code: 'STK_FAILED', error: push.error || push.message || 'M-Pesa couldn\'t send the prompt. Try again.' };
  }

  const { data: updated } = await supabaseAdmin
    .from('MpesaPayment')
    .update({ checkoutRequestId: push.checkoutRequestId, merchantRequestId: push.requestId ?? null, updatedAt: new Date().toISOString() })
    .eq('id', payment.id)
    .select(SELECT)
    .single();
  return { ok: true, payment: (updated as MpesaPayment) ?? payment, message: 'Prompt sent. Ask the customer to enter their M-Pesa PIN.' };
}

/** The payment as the till sees it. A prompt that has gone quiet is checked with Safaricom, then given up on. */
export async function getStkPayment(organizationId: string, id: string, now: number = Date.now()): Promise<MpesaPayment | null> {
  const { data } = await supabaseAdmin.from('MpesaPayment').select(SELECT).eq('id', id).eq('organizationId', organizationId).maybeSingle();
  const payment = data as MpesaPayment | null;
  if (!payment || payment.status !== 'pending') return payment;

  const age = now - Date.parse(payment.createdAt);
  if (payment.checkoutRequestId && age >= QUERY_AFTER_MS) {
    const outcome = await queryOutcome(organizationId, payment.checkoutRequestId);
    if (outcome) return (await settle(payment.id, outcome)) ?? payment;
  }
  if (age >= EXPIRE_AFTER_MS) {
    return (await settle(payment.id, { status: 'failed', resultDesc: 'No answer from M-Pesa. Check the customer\'s messages before trying again.' })) ?? payment;
  }
  return payment;
}

interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name?: string; Value?: unknown }[] };
    };
  };
}

/** Applies Safaricom's result for one prompt. Returns false if the callback doesn't match an open payment. */
export async function handleStkCallback(callbackToken: string, body: StkCallbackBody): Promise<boolean> {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID || cb.ResultCode === undefined) return false;

  const { data } = await supabaseAdmin
    .from('MpesaPayment')
    .select('id, amount, status, resultCode, mpesaReceipt')
    .eq('checkoutRequestId', cb.CheckoutRequestID)
    .eq('callbackToken', callbackToken)
    .maybeSingle();
  const row = data as { id: string; amount: number; status: MpesaPaymentStatus; resultCode: number | null; mpesaReceipt: string | null } | null;
  if (!row) return false;

  const code = Number(cb.ResultCode);
  const items = cb.CallbackMetadata?.Item ?? [];
  const item = (name: string) => items.find((i) => i.Name === name)?.Value;

  // Confirmed earlier by asking Safaricom, which doesn't give the receipt number: fill it in now.
  if (row.status === 'success') {
    const receipt = item('MpesaReceiptNumber');
    if (code === 0 && !row.mpesaReceipt && typeof receipt === 'string') await settle(row.id, { status: 'success', mpesaReceipt: receipt });
    return true;
  }
  // Settled already — except a prompt we stopped waiting for, which the late callback may still complete.
  if (row.status !== 'pending' && !(row.status === 'failed' && row.resultCode === null)) return false;
  if (code === 0) {
    const paid = Number(item('Amount'));
    if (Number.isFinite(paid) && paid < row.amount) {
      logger.warn('[mpesa] paid less than requested', { id: row.id, paid, requested: row.amount });
      await settle(row.id, { status: 'failed', resultCode: code, resultDesc: `Only KES ${paid} was paid` });
      return true;
    }
    const receipt = item('MpesaReceiptNumber');
    await settle(row.id, { status: 'success', resultCode: 0, resultDesc: cb.ResultDesc ?? 'Paid', mpesaReceipt: typeof receipt === 'string' ? receipt : null });
  } else {
    await settle(row.id, { status: code === CANCELLED_BY_USER ? 'cancelled' : 'failed', resultCode: code, resultDesc: cb.ResultDesc ?? 'Not paid' });
  }
  return true;
}

type Outcome = { status: MpesaPaymentStatus; resultCode?: number | null; resultDesc?: string | null; mpesaReceipt?: string | null };

async function settle(id: string, outcome: Outcome): Promise<MpesaPayment | null> {
  const { data } = await supabaseAdmin
    .from('MpesaPayment')
    .update({ ...outcome, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT)
    .maybeSingle();
  return data as MpesaPayment | null;
}

/** Safaricom's own answer for a prompt; null while it's still waiting on the customer. */
async function queryOutcome(organizationId: string, checkoutRequestId: string): Promise<Outcome | null> {
  const client = await getMpesaClientForOrganization(organizationId);
  if (!client) return null;
  try {
    const res = await client.queryTransactionStatus(checkoutRequestId);
    if (res.ResultCode === undefined || res.ResultCode === null) return null;
    const code = Number(res.ResultCode);
    const desc = typeof res.ResultDesc === 'string' ? res.ResultDesc : null;
    // The query doesn't carry the receipt number; the callback fills it in if it still arrives.
    if (code === 0) return { status: 'success', resultCode: 0, resultDesc: desc ?? 'Paid' };
    return { status: code === CANCELLED_BY_USER ? 'cancelled' : 'failed', resultCode: code, resultDesc: desc };
  } catch {
    return null; // "still being processed" comes back as an error; keep waiting
  }
}
