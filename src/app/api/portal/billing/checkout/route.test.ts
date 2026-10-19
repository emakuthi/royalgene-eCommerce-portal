import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/authorize', () => ({
  requireRole: vi.fn(() => ({ userId: 'u-1', role: 'admin', organizationId: 'org-1', email: 'owner@shop.test' })),
}));

const getPlanById = vi.fn();
vi.mock('@/lib/billing-plans.server', () => ({ getPlanById: (...a: unknown[]) => getPlanById(...a) }));

const getOrganizationById = vi.fn();
vi.mock('@/lib/organizations.server', () => ({ getOrganizationById: (...a: unknown[]) => getOrganizationById(...a) }));

const initializeTransaction = vi.fn();
vi.mock('@/lib/paystack.server', () => ({
  isPaystackConfigured: () => true,
  initializeTransaction: (...a: unknown[]) => initializeTransaction(...a),
}));

vi.mock('@/lib/urls', () => ({ getOrgUrlFor: () => 'https://shop.royaltrack.test/settings?tab=billing' }));

import { POST } from './route';

const PLAN = {
  id: 'plan-biz', isActive: true, currency: 'KES', monthlyPriceKobo: 350000, annualPriceKobo: 3500000,
  paystackMonthlyPlanCode: 'PLN_m', paystackAnnualPlanCode: 'PLN_a',
};
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/portal/billing/checkout', {
  method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getPlanById.mockResolvedValue(PLAN);
  getOrganizationById.mockResolvedValue({ id: 'org-1', slug: 'shop', billingStatus: null, paystackPlanCode: null });
  initializeTransaction.mockResolvedValue({ ok: true, data: { authorizationUrl: 'https://checkout.paystack.com/x', reference: 'ref-1', accessCode: 'a' } });
});

describe('POST /api/portal/billing/checkout', () => {
  it('card (the default) starts a Paystack subscription on the plan', async () => {
    const res = await post({ planId: 'plan-biz', interval: 'monthly' });
    expect(res.status).toBe(200);
    expect(initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amountKobo: 350000, planCode: 'PLN_m', channels: undefined,
      metadata: { organizationId: 'org-1', planId: 'plan-biz', interval: 'monthly', method: 'card' },
    }));
  });

  it('M-Pesa is a one-off payment for one period, M-Pesa only', async () => {
    const res = await post({ planId: 'plan-biz', interval: 'annually', method: 'mpesa' });
    expect(res.status).toBe(200);
    expect(initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amountKobo: 3500000, planCode: null, channels: ['mobile_money'],
      metadata: { organizationId: 'org-1', planId: 'plan-biz', interval: 'annually', method: 'mpesa' },
    }));
  });

  it('refuses M-Pesa while a card subscription still renews, so nobody pays twice', async () => {
    getOrganizationById.mockResolvedValue({ id: 'org-1', slug: 'shop', billingStatus: 'active', paystackPlanCode: 'PLN_m' });
    const res = await post({ planId: 'plan-biz', interval: 'monthly', method: 'mpesa' });
    expect(res.status).toBe(409);
    expect(initializeTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown payment method', async () => {
    const res = await post({ planId: 'plan-biz', interval: 'monthly', method: 'bitcoin' });
    expect(res.status).toBe(400);
  });
});
