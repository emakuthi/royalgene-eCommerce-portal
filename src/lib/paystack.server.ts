import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import logger from './logger';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getSecretKey(): string | null {
  return process.env.PAYSTACK_SECRET_KEY || null;
}

export const isPaystackConfigured = (): boolean => Boolean(getSecretKey());

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    return { ok: false, error: 'Paystack is not configured (PAYSTACK_SECRET_KEY missing)' };
  }
  try {
    const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.status === false) {
      const message = typeof json?.message === 'string' ? json.message : `Paystack responded ${res.status}`;
      logger.warn('[paystack] request failed', { path, status: res.status, message });
      return { ok: false, error: message };
    }
    return { ok: true, data: json?.data as T };
  } catch (err) {
    logger.error('[paystack] request threw', { path, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : 'Paystack request failed' };
  }
}

export interface CreatePaystackPlanInput {
  name: string;
  amountKobo: number;
  interval: 'monthly' | 'annually';
  currency?: string;
}

/** Creates a Plan on Paystack. Returns the plan_code, or null if unconfigured/failed (fail-soft — caller decides how to handle). */
export async function createPaystackPlan(input: CreatePaystackPlanInput): Promise<string | null> {
  const result = await paystackFetch<{ plan_code: string }>('/plan', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      amount: input.amountKobo,
      interval: input.interval,
      currency: input.currency || 'KES',
    }),
  });
  if (!result.ok) return null;
  return result.data.plan_code;
}

export interface InitializeTransactionInput {
  email: string;
  amountKobo: number;
  currency?: string;
  planCode?: string | null;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export async function initializeTransaction(
  input: InitializeTransactionInput,
): Promise<{ ok: true; data: InitializeTransactionResult } | { ok: false; error: string }> {
  const result = await paystackFetch<{ authorization_url: string; access_code: string; reference: string }>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      currency: input.currency || 'KES',
      plan: input.planCode || undefined,
      callback_url: input.callbackUrl,
      metadata: input.metadata || {},
    }),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      authorizationUrl: result.data.authorization_url,
      accessCode: result.data.access_code,
      reference: result.data.reference,
    },
  };
}

export interface PaystackTransactionData {
  status: string; // 'success' | 'failed' | 'abandoned' | ...
  reference: string;
  amount: number;
  currency: string;
  customer: { email: string; customer_code?: string };
  plan?: { plan_code?: string } | null;
  metadata?: Record<string, unknown>;
  subscription_code?: string;
}

export async function verifyTransaction(reference: string): Promise<{ ok: true; data: PaystackTransactionData } | { ok: false; error: string }> {
  return paystackFetch<PaystackTransactionData>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
}

/**
 * Verifies the `x-paystack-signature` header: HMAC-SHA512 of the raw request
 * body using PAYSTACK_SECRET_KEY. Paystack has no separate webhook-signing
 * secret — the account secret key is used directly, unlike Stripe.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secretKey = getSecretKey();
  if (!secretKey || !signatureHeader) return false;
  try {
    const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}
