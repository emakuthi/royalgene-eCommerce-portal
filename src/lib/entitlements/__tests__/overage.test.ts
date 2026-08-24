import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from './supabase-mock';

const ORG_ID = 'org-1';
const ORG_NO_OVERAGE = 'org-2';
const PLAN_OVERAGE = 'plan-overage';
const PLAN_STRICT = 'plan-strict';

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

function baseTables(): MockTables {
  return {
    Organization: [
      { id: ORG_ID, planTier: 'starter' },
      { id: ORG_NO_OVERAGE, planTier: 'starter' },
    ],
    TenantSubscription: [
      { organizationId: ORG_ID, planId: PLAN_OVERAGE, status: 'active', trialEnd: null, billingInterval: 'monthly' },
      { organizationId: ORG_NO_OVERAGE, planId: PLAN_STRICT, status: 'active', trialEnd: null, billingInterval: 'monthly' },
    ],
    PlatformPlan: [
      { id: PLAN_OVERAGE, tier: 'starter', code: 'STARTER', monthlyPriceKobo: 500000, annualPriceKobo: 5000000, currency: 'KES', allowOverage: true },
      { id: PLAN_STRICT, tier: 'starter', code: 'STARTER', monthlyPriceKobo: 500000, annualPriceKobo: 5000000, currency: 'KES', allowOverage: false },
    ],
    PlanEntitlement: [
      { planId: PLAN_OVERAGE, code: 'PRODUCTS', enabled: true, limitValue: 10 },
      { planId: PLAN_STRICT, code: 'PRODUCTS', enabled: true, limitValue: 10 },
    ],
    PlanOverageRate: [{ planId: PLAN_OVERAGE, limitCode: 'PRODUCTS', unit: 1, pricePerUnitKobo: 1000 }],
    Product: [],
    PortalUser: [],
    Shop: [],
    SalesEntry: [],
    TenantFileUpload: [],
    Invoice: [],
  };
}

beforeEach(() => {
  mockTables = baseTables();
});

describe('computeOverageLineItems', () => {
  it('bills for units over the limit at the configured rate', async () => {
    mockTables.Product = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, organizationId: ORG_ID })); // 3 over the 10-limit
    const { computeOverageLineItems } = await import('../overage.server');
    const result = await computeOverageLineItems(ORG_ID);
    expect(result.overageKobo).toBe(3000); // 3 units * 1000 kobo
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]).toMatchObject({ limitCode: 'PRODUCTS', quantity: 3, subtotalKobo: 3000 });
  });

  it('is zero when usage is within the limit', async () => {
    mockTables.Product = [{ id: 'p1', organizationId: ORG_ID }];
    const { computeOverageLineItems } = await import('../overage.server');
    const result = await computeOverageLineItems(ORG_ID);
    expect(result.overageKobo).toBe(0);
    expect(result.lineItems).toHaveLength(0);
  });

  it('is zero when the plan does not allow overage, even if over the limit', async () => {
    mockTables.Product = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, organizationId: ORG_NO_OVERAGE }));
    const { computeOverageLineItems } = await import('../overage.server');
    const result = await computeOverageLineItems(ORG_NO_OVERAGE);
    expect(result.overageKobo).toBe(0);
  });
});

describe('generateInvoice', () => {
  it('combines base plan price and overage into a persisted invoice', async () => {
    mockTables.Product = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, organizationId: ORG_ID })); // 5 over
    const { generateInvoice } = await import('../overage.server');
    const invoice = await generateInvoice(ORG_ID, '2026-08');

    expect(invoice).not.toBeNull();
    expect(invoice!.basePriceKobo).toBe(500000);
    expect(invoice!.overageKobo).toBe(5000);
    expect(invoice!.totalKobo).toBe(505000);
    expect(invoice!.status).toBe('due');
    expect(mockTables.Invoice).toHaveLength(1);
  });

  it('is idempotent per (org, period) — regenerating updates the same row instead of duplicating', async () => {
    mockTables.Product = [{ id: 'p1', organizationId: ORG_ID }];
    const { generateInvoice } = await import('../overage.server');
    await generateInvoice(ORG_ID, '2026-08');
    mockTables.Product = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, organizationId: ORG_ID })); // now 2 over
    const second = await generateInvoice(ORG_ID, '2026-08');

    expect(mockTables.Invoice).toHaveLength(1);
    expect(second!.overageKobo).toBe(2000);
  });

  it('never overwrites an invoice that has already been settled', async () => {
    mockTables.Invoice = [
      { id: 'inv-1', organizationId: ORG_ID, period: '2026-08', basePriceKobo: 500000, overageKobo: 0, totalKobo: 500000, currency: 'KES', status: 'paid' },
    ];
    mockTables.Product = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, organizationId: ORG_ID }));
    const { generateInvoice } = await import('../overage.server');
    const invoice = await generateInvoice(ORG_ID, '2026-08');

    expect(invoice!.status).toBe('paid');
    expect(invoice!.totalKobo).toBe(500000); // unchanged, not recomputed with the new overage
  });
});
