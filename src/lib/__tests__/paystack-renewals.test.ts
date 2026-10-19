import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  dueOrgs, fetchCustomerId, listSuccessfulTransactions, getPlanById, getPlanByPaystackCode,
  applySuccessfulSubscription, recordBillingEvent, wasReferenceProcessed,
} = vi.hoisted(() => ({
  dueOrgs: vi.fn(),
  fetchCustomerId: vi.fn(),
  listSuccessfulTransactions: vi.fn(),
  getPlanById: vi.fn(),
  getPlanByPaystackCode: vi.fn(),
  applySuccessfulSubscription: vi.fn(),
  recordBillingEvent: vi.fn(),
  wasReferenceProcessed: vi.fn(),
}));

vi.mock('@/lib/supabase-client', () => {
  const chain = {
    select: () => chain,
    not: () => chain,
    gt: () => chain,
    lt: () => dueOrgs(),
  };
  return { supabaseAdmin: { from: () => chain } };
});

vi.mock('@/lib/paystack.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/paystack.server')>()),
  fetchCustomerId,
  listSuccessfulTransactions,
}));

vi.mock('@/lib/billing-plans.server', () => ({ getPlanById, getPlanByPaystackCode }));

vi.mock('@/lib/billing.server', () => ({ applySuccessfulSubscription, recordBillingEvent, wasReferenceProcessed }));

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { reconcilePaystackRenewals } from '../billing/paystack-renewals.server';

const ORG = { id: 'org-1', paystackCustomerCode: 'CUS_1', paidThrough: '2026-11-19T08:00:00.000Z' };
const BUSINESS = { id: 'plan-business', tier: 'business' };

beforeEach(() => {
  vi.clearAllMocks();
  dueOrgs.mockResolvedValue({ data: [ORG], error: null });
  fetchCustomerId.mockResolvedValue(42);
  wasReferenceProcessed.mockResolvedValue(false);
  getPlanById.mockResolvedValue(null);
  getPlanByPaystackCode.mockResolvedValue(null);
});

describe('reconcilePaystackRenewals', () => {
  it('applies a renewal charge the webhook missed, matched by its Paystack plan code', async () => {
    getPlanByPaystackCode.mockResolvedValue({ plan: BUSINESS, interval: 'monthly' });
    listSuccessfulTransactions.mockResolvedValue({ ok: true, data: [
      { reference: 'renew-1', status: 'success', paid_at: '2026-11-19T08:01:00Z', metadata: '', plan: { plan_code: 'PLN_biz' } },
    ] });

    const result = await reconcilePaystackRenewals(new Date('2026-11-19T09:00:00Z'));

    expect(result).toEqual({ checked: 1, applied: 1, failed: 0 });
    expect(applySuccessfulSubscription).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', plan: BUSINESS, interval: 'monthly', reference: 'renew-1', paystackCustomerCode: 'CUS_1',
      paystackPlanCode: 'PLN_biz',
    }));
  });

  it('skips charges already applied by the webhook or the checkout return', async () => {
    wasReferenceProcessed.mockResolvedValue(true);
    listSuccessfulTransactions.mockResolvedValue({ ok: true, data: [
      { reference: 'seen', status: 'success', plan: { plan_code: 'PLN_biz' } },
    ] });

    const result = await reconcilePaystackRenewals();

    expect(result.applied).toBe(0);
    expect(applySuccessfulSubscription).not.toHaveBeenCalled();
  });

  it('ignores FleetTrack payments, other workspaces\' payments and non-subscription charges', async () => {
    getPlanById.mockResolvedValue(BUSINESS);
    listSuccessfulTransactions.mockResolvedValue({ ok: true, data: [
      { reference: 'ft-123', status: 'success', metadata: { planId: 'plan-business' } },
      { reference: 'other-org', status: 'success', metadata: { organizationId: 'org-2', planId: 'plan-business' } },
      { reference: 'one-off', status: 'success', metadata: {}, plan: {} },
    ] });

    const result = await reconcilePaystackRenewals();

    expect(result.applied).toBe(0);
    expect(applySuccessfulSubscription).not.toHaveBeenCalled();
  });

  it('applies several missed charges oldest first', async () => {
    getPlanById.mockResolvedValue(BUSINESS);
    listSuccessfulTransactions.mockResolvedValue({ ok: true, data: [
      { reference: 'newer', status: 'success', paid_at: '2026-12-19T08:00:00Z', metadata: JSON.stringify({ planId: 'plan-business', interval: 'monthly' }) },
      { reference: 'older', status: 'success', paid_at: '2026-11-19T08:00:00Z', metadata: { planId: 'plan-business', interval: 'monthly' } },
    ] });

    await reconcilePaystackRenewals();

    expect(applySuccessfulSubscription.mock.calls.map((c) => c[0].reference)).toEqual(['older', 'newer']);
    // Paid by M-Pesa (no Paystack plan): the workspace doesn't renew by itself.
    expect(applySuccessfulSubscription.mock.calls[0][0].paystackPlanCode).toBeNull();
  });

  it('counts a Paystack failure for one workspace without stopping the rest', async () => {
    dueOrgs.mockResolvedValue({ data: [ORG, { ...ORG, id: 'org-2', paystackCustomerCode: 'CUS_2' }], error: null });
    fetchCustomerId.mockResolvedValueOnce(null).mockResolvedValueOnce(43);
    getPlanByPaystackCode.mockResolvedValue({ plan: BUSINESS, interval: 'monthly' });
    listSuccessfulTransactions.mockResolvedValue({ ok: true, data: [
      { reference: 'renew-2', status: 'success', plan_object: { plan_code: 'PLN_biz' } },
    ] });

    const result = await reconcilePaystackRenewals();

    expect(result).toEqual({ checked: 2, applied: 1, failed: 1 });
  });
});
