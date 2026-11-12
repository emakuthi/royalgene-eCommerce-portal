import 'server-only';
import type { VerifiedPayload } from './auth.server';
import { jsonResponse } from './apiResponse';
import { assignedShops, denyUnlessShopAllowed, isBusinessAdmin } from './shop-access.server';
import { denyWithoutCapability } from './permissions.server';
import {
  createCustomer, deleteCustomer, deleteCustomerPayment, getCustomer, listCustomers,
  recordCustomerPayment, updateCustomer,
} from './customers.server';
import logger from './logger';

/**
 * Handlers behind /api/portal/customers/* and /api/mobile/customers/* — the
 * routes only authenticate and pass the caller in. Staff see balances for
 * their own shops' credit sales and repayments, like sales; admins see all.
 */

type Out = Response;

const unavailable = (err: unknown): Out => {
  logger.error('[customers] request failed', { error: err instanceof Error ? err.message : String(err) });
  return jsonResponse({ success: false, error: 'Customers are not available yet (migration 20261112_01 run?)', code: 'INTERNAL_ERROR' }, 500);
};

const send = (r: { ok: true; data: unknown } | { ok: false; status: number; error: string; code: string }, status = 200): Out =>
  r.ok ? jsonResponse({ success: true, data: r.data }, status) : jsonResponse({ success: false, error: r.error, code: r.code }, r.status);

const shopScope = async (p: VerifiedPayload) => (await assignedShops(p))?.map((s) => s.id) ?? null;

export async function customersList(p: VerifiedPayload): Promise<Out> {
  try {
    return jsonResponse({ success: true, data: await listCustomers(p.organizationId!, await shopScope(p)) });
  } catch (err) {
    return unavailable(err);
  }
}

export async function customersCreate(p: VerifiedPayload, body: Record<string, unknown>): Promise<Out> {
  const denied = await denyWithoutCapability(p, 'sell_on_credit', 'add credit customers');
  if (denied) return denied;
  return send(await createCustomer(p.organizationId!, body, p.userId ?? null), 201);
}

export async function customerGet(p: VerifiedPayload, id: string): Promise<Out> {
  try {
    const detail = await getCustomer(p.organizationId!, id, await shopScope(p));
    if (!detail) return jsonResponse({ success: false, error: 'Customer not found', code: 'NOT_FOUND' }, 404);
    return jsonResponse({ success: true, data: { ...detail, canDeletePayments: isBusinessAdmin(p) } });
  } catch (err) {
    return unavailable(err);
  }
}

export async function customerUpdate(p: VerifiedPayload, id: string, body: Record<string, unknown>): Promise<Out> {
  const denied = await denyWithoutCapability(p, 'sell_on_credit', 'edit credit customers');
  if (denied) return denied;
  return send(await updateCustomer(p.organizationId!, id, body));
}

export async function customerDelete(p: VerifiedPayload, id: string): Promise<Out> {
  if (!isBusinessAdmin(p)) return jsonResponse({ success: false, error: 'Only the business owner can remove customers', code: 'FORBIDDEN' }, 403);
  return send(await deleteCustomer(p.organizationId!, id));
}

export async function customerPaymentCreate(p: VerifiedPayload, customerId: string, body: Record<string, unknown>): Promise<Out> {
  const denied = await denyWithoutCapability(p, 'record_sales', 'record payments');
  if (denied) return denied;
  if (typeof body.shopId === 'string') {
    const notYours = await denyUnlessShopAllowed(p, body.shopId);
    if (notYours) return notYours;
  }
  return send(await recordCustomerPayment(p.organizationId!, customerId, body, p.userId ?? null), 201);
}

export async function customerPaymentDelete(p: VerifiedPayload, paymentId: string): Promise<Out> {
  if (!isBusinessAdmin(p)) return jsonResponse({ success: false, error: 'Only the business owner can undo a payment', code: 'FORBIDDEN' }, 403);
  return send(await deleteCustomerPayment(p.organizationId!, paymentId));
}
