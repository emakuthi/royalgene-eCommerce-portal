import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { state, getMpesaClientForOrganization } = vi.hoisted(() => ({
  state: { row: null as Record<string, unknown> | null, updates: [] as Record<string, unknown>[], inserted: null as Record<string, unknown> | null },
  getMpesaClientForOrganization: vi.fn(),
}));

vi.mock('../supabase-client', () => {
  const chain = (): Record<string, unknown> => {
    let pending: Record<string, unknown> | null = null;
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      insert: (rows: Record<string, unknown>[]) => { state.inserted = rows[0]; return c; },
      update: (patch: Record<string, unknown>) => { pending = patch; state.updates.push(patch); return c; },
      maybeSingle: async () => ({ data: pending ? { ...state.row, ...pending } : state.row, error: null }),
      single: async () => ({ data: state.inserted ? { id: 'pay-1', status: 'pending', createdAt: new Date().toISOString(), ...state.inserted } : state.row, error: null }),
    };
    return c;
  };
  return { supabaseAdmin: { from: () => chain() } };
});
vi.mock('../mpesa', () => ({ getMpesaClientForOrganization }));
vi.mock('../integrations/tenant-integration-config.server', () => ({ getMpesaConfigSummary: vi.fn() }));
vi.mock('../tenant', () => ({ ROOT_DOMAIN: 'royaltrack.test' }));
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { handleStkCallback, normalizeKenyanPhone, startStkPayment } from '../mpesa-payments.server';

const callback = (code: number, items: { Name: string; Value: unknown }[] = []) => ({
  Body: { stkCallback: { MerchantRequestID: 'm-1', CheckoutRequestID: 'ws_CO_1', ResultCode: code, ResultDesc: 'desc', CallbackMetadata: { Item: items } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.row = { id: 'pay-1', amount: 450, status: 'pending', resultCode: null, mpesaReceipt: null };
  state.updates = [];
  state.inserted = null;
});

describe('normalizeKenyanPhone', () => {
  it('accepts the usual ways people type a Safaricom number', () => {
    for (const input of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678', '0112345678']) {
      expect(normalizeKenyanPhone(input)).toMatch(/^254[17]\d{8}$/);
    }
  });

  it('rejects numbers that are not Kenyan mobiles', () => {
    for (const input of ['', '0212345678', '07123', '+1 415 555 0100']) {
      expect(normalizeKenyanPhone(input)).toBeNull();
    }
  });
});

describe('handleStkCallback', () => {
  it('marks the payment paid with its M-Pesa receipt', async () => {
    const ok = await handleStkCallback('tok', callback(0, [{ Name: 'Amount', Value: 450 }, { Name: 'MpesaReceiptNumber', Value: 'TJK7ABC123' }]));
    expect(ok).toBe(true);
    expect(state.updates.at(-1)).toMatchObject({ status: 'success', resultCode: 0, mpesaReceipt: 'TJK7ABC123' });
  });

  it('records a cancelled prompt as cancelled and other failures as failed', async () => {
    await handleStkCallback('tok', callback(1032));
    expect(state.updates.at(-1)).toMatchObject({ status: 'cancelled', resultCode: 1032 });
    state.row = { ...state.row, status: 'pending' };
    await handleStkCallback('tok', callback(1));
    expect(state.updates.at(-1)).toMatchObject({ status: 'failed', resultCode: 1 });
  });

  it('refuses a payment for less than was asked', async () => {
    await handleStkCallback('tok', callback(0, [{ Name: 'Amount', Value: 1 }, { Name: 'MpesaReceiptNumber', Value: 'X' }]));
    expect(state.updates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('never re-opens a settled payment', async () => {
    state.row = { ...state.row, status: 'cancelled', resultCode: 1032 };
    expect(await handleStkCallback('tok', callback(0, [{ Name: 'Amount', Value: 450 }]))).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('fills in the receipt for a payment already confirmed by asking Safaricom', async () => {
    state.row = { ...state.row, status: 'success', resultCode: 0, mpesaReceipt: null };
    await handleStkCallback('tok', callback(0, [{ Name: 'Amount', Value: 450 }, { Name: 'MpesaReceiptNumber', Value: 'TJK7LATE' }]));
    expect(state.updates.at(-1)).toMatchObject({ mpesaReceipt: 'TJK7LATE' });
  });

  it('ignores a callback that matches no payment for this token', async () => {
    state.row = null;
    expect(await handleStkCallback('wrong', callback(0))).toBe(false);
  });
});

describe('startStkPayment', () => {
  it('needs the workspace to have its own M-Pesa keys', async () => {
    getMpesaClientForOrganization.mockResolvedValue(null);
    const result = await startStkPayment({ organizationId: 'org-1', shopId: 's-1', requestedBy: 'u-1', phone: '0712345678', amount: 450 });
    expect(result).toMatchObject({ ok: false, code: 'MPESA_NOT_CONFIGURED' });
  });

  it('sends the prompt for whole shillings to the normalised number, reporting to its own callback', async () => {
    const initiateStkPush = vi.fn().mockResolvedValue({ success: true, checkoutRequestId: 'ws_CO_1', requestId: 'm-1' });
    getMpesaClientForOrganization.mockResolvedValue({ initiateStkPush });
    const result = await startStkPayment({ organizationId: 'org-1', shopId: 's-1', requestedBy: 'u-1', phone: '0712 345 678', amount: 449.5 });
    expect(result.ok).toBe(true);
    expect(initiateStkPush).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: '254712345678', amount: 450 }));
    expect(getMpesaClientForOrganization.mock.calls[0][1]).toMatch(/^https:\/\/royaltrack\.test\/api\/webhooks\/mpesa\/[0-9a-f]{48}$/);
  });

  it('rejects a bad phone number before contacting Safaricom', async () => {
    const result = await startStkPayment({ organizationId: 'org-1', shopId: null, requestedBy: null, phone: '12345', amount: 100 });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PHONE' });
    expect(getMpesaClientForOrganization).not.toHaveBeenCalled();
  });
});
