import { describe, it, expect, vi, beforeEach } from 'vitest';

// A sale with any credit in it must name a live customer of the same
// workspace, and the seller must be allowed to sell on credit.

vi.mock('server-only', () => ({}));
vi.mock('../logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../sync/idempotent-insert.server', () => ({ idempotentInsert: vi.fn() }));

const state = { canSellOnCredit: true, customer: { id: '', name: 'Mama Njeri', phone: '0712345678' } as Record<string, unknown> | null };
vi.mock('../permissions.server', () => ({ hasCapability: vi.fn(async () => state.canSellOnCredit) }));

const filters: Array<[string, unknown]> = [];
vi.mock('../supabase-client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'is']) chain[m] = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => { filters.push([col, val]); return chain; });
  chain.maybeSingle = vi.fn(async () => ({ data: state.customer }));
  return { supabaseAdmin: chain };
});

import { resolveSaleCustomer, checkSaleEditCustomer } from '../customers.server';

const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org-1' } as never;
const CUSTOMER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

beforeEach(() => {
  state.canSellOnCredit = true;
  state.customer = { id: CUSTOMER, name: 'Mama Njeri', phone: '0712345678' };
  filters.length = 0;
});

describe('resolveSaleCustomer', () => {
  it('needs a customer for a credit sale', async () => {
    const r = await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Credit' });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'CUSTOMER_REQUIRED' });
  });

  it('needs one for a split that includes credit too', async () => {
    const r = await resolveSaleCustomer(payload, 'org-1', {
      paymentMethod: 'Cash + Credit',
      paymentBreakdown: [{ method: 'Cash', amount: 500 }, { method: 'Credit', amount: 1500 }],
    });
    expect(r).toMatchObject({ ok: false, code: 'CUSTOMER_REQUIRED' });
  });

  it('refuses a seller who may not sell on credit', async () => {
    state.canSellOnCredit = false;
    const r = await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Credit', customerId: CUSTOMER });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('accepts a credit sale to a customer of this workspace', async () => {
    const r = await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Credit', customerId: CUSTOMER });
    expect(r).toEqual({ ok: true, customer: state.customer });
    expect(filters).toContainEqual(['organizationId', 'org-1']);
  });

  it('refuses a credit sale to a customer it can\'t find', async () => {
    state.customer = null;
    const r = await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Credit', customerId: CUSTOMER });
    expect(r).toMatchObject({ ok: false, code: 'CUSTOMER_NOT_FOUND' });
  });

  it('lets a paid sale go through without a customer, or with an unknown one dropped', async () => {
    expect(await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Cash' })).toEqual({ ok: true, customer: null });
    state.customer = null;
    expect(await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Cash', customerId: CUSTOMER })).toEqual({ ok: true, customer: null });
  });

  it('rejects a malformed customer id', async () => {
    expect(await resolveSaleCustomer(payload, 'org-1', { paymentMethod: 'Cash', customerId: 'abc' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('checkSaleEditCustomer', () => {
  const sale = { id: 's1', organizationId: 'org-1', paymentMethod: 'Cash', customerId: null };

  it('leaves edits that touch neither method nor customer alone', async () => {
    const body = { quantity: 2 };
    expect(await checkSaleEditCustomer(payload, sale, body)).toEqual({ ok: true, body });
  });

  it('refuses switching a sale to credit without a customer', async () => {
    expect(await checkSaleEditCustomer(payload, sale, { paymentMethod: 'Credit' })).toMatchObject({ ok: false, code: 'CUSTOMER_REQUIRED' });
  });

  it('keeps the sale\'s existing customer when switching to credit', async () => {
    const r = await checkSaleEditCustomer(payload, { ...sale, customerId: CUSTOMER }, { paymentMethod: 'Credit' });
    expect(r).toEqual({ ok: true, body: { paymentMethod: 'Credit', customerId: CUSTOMER } });
  });
});
