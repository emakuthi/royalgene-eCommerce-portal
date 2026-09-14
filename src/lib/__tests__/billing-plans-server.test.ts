import { describe, it, expect, vi, beforeEach } from 'vitest';

const isPaystackConfiguredMock = vi.fn(() => true);
const createPaystackPlanMock = vi.fn(async (input: { name: string; interval: string }) =>
  input.interval === 'monthly' ? 'PLN_monthly_new' : 'PLN_annual_new',
);
vi.mock('../paystack.server', () => ({
  isPaystackConfigured: () => isPaystackConfiguredMock(),
  createPaystackPlan: (input: { name: string; amountKobo: number; interval: string; currency?: string }) =>
    createPaystackPlanMock(input),
}));

const state = { plan: null as Record<string, unknown> | null, updated: null as Record<string, unknown> | null };

function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update']) obj[m] = vi.fn(() => obj);
  obj.maybeSingle = vi.fn(async () => resolveValue);
  return obj;
}

vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const obj: Record<string, unknown> = {};
      obj.select = vi.fn(() => obj);
      obj.eq = vi.fn(() => obj);
      obj.maybeSingle = vi.fn(async () => ({ data: state.plan, error: null }));
      obj.update = vi.fn((patch: Record<string, unknown>) => {
        state.updated = patch;
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { ...state.plan, ...patch }, error: null })),
            })),
          })),
        };
      });
      return obj;
    }),
  },
}));

import { ensurePaystackPlanCodes } from '../billing-plans.server';

const basePlan = {
  id: 'plan-1',
  name: 'Business',
  monthlyPriceKobo: 350000,
  annualPriceKobo: 3500000,
  currency: 'KES',
  paystackMonthlyPlanCode: null,
  paystackAnnualPlanCode: null,
};

describe('ensurePaystackPlanCodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPaystackConfiguredMock.mockReturnValue(true);
    state.plan = null;
    state.updated = null;
  });

  it('returns null when the plan does not exist', async () => {
    state.plan = null;
    const result = await ensurePaystackPlanCodes('missing');
    expect(result).toBeNull();
  });

  it('is a no-op when both codes already exist — never re-mints or overwrites', async () => {
    state.plan = { ...basePlan, paystackMonthlyPlanCode: 'PLN_m_existing', paystackAnnualPlanCode: 'PLN_a_existing' };
    const result = await ensurePaystackPlanCodes('plan-1');
    expect(result).toMatchObject({ paystackMonthlyPlanCode: 'PLN_m_existing', paystackAnnualPlanCode: 'PLN_a_existing' });
    expect(createPaystackPlanMock).not.toHaveBeenCalled();
  });

  it('leaves the plan untouched when Paystack is not configured', async () => {
    isPaystackConfiguredMock.mockReturnValue(false);
    state.plan = { ...basePlan };
    const result = await ensurePaystackPlanCodes('plan-1');
    expect(result).toMatchObject({ paystackMonthlyPlanCode: null, paystackAnnualPlanCode: null });
    expect(createPaystackPlanMock).not.toHaveBeenCalled();
  });

  it('mints both missing codes and persists them, using the EXISTING price (never a new amount)', async () => {
    state.plan = { ...basePlan };
    const result = await ensurePaystackPlanCodes('plan-1');
    expect(createPaystackPlanMock).toHaveBeenCalledWith(expect.objectContaining({ interval: 'monthly', amountKobo: 350000 }));
    expect(createPaystackPlanMock).toHaveBeenCalledWith(expect.objectContaining({ interval: 'annually', amountKobo: 3500000 }));
    expect(result).toMatchObject({ paystackMonthlyPlanCode: 'PLN_monthly_new', paystackAnnualPlanCode: 'PLN_annual_new' });
  });

  it('only mints the ONE missing code when the other already exists — never touches the existing one', async () => {
    state.plan = { ...basePlan, paystackMonthlyPlanCode: 'PLN_m_existing', paystackAnnualPlanCode: null };
    const result = await ensurePaystackPlanCodes('plan-1');
    expect(createPaystackPlanMock).toHaveBeenCalledTimes(1);
    expect(createPaystackPlanMock).toHaveBeenCalledWith(expect.objectContaining({ interval: 'annually' }));
    expect(result).toMatchObject({ paystackMonthlyPlanCode: 'PLN_m_existing', paystackAnnualPlanCode: 'PLN_annual_new' });
  });
});
