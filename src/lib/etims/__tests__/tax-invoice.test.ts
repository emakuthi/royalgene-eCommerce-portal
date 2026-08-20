import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../../entitlements/__tests__/supabase-mock';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PLAN_ID = 'plan-1';
const SALE_ID = 'sale-1';

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

function baseTables(overrides: Partial<MockTables> = {}): MockTables {
  return {
    Organization: [
      { id: ORG_A, planTier: 'starter', kraPin: 'P000111222A' },
      { id: ORG_B, planTier: 'starter', kraPin: null },
    ],
    TenantSubscription: [{ organizationId: ORG_A, planId: PLAN_ID, status: 'active', trialEnd: null }],
    PlatformPlan: [{ id: PLAN_ID, tier: 'starter', code: 'STARTER' }],
    PlanEntitlement: [{ planId: PLAN_ID, code: 'ETIMS_INTEGRATION', enabled: true, limitValue: null }],
    SalesEntry: [{ id: SALE_ID, organizationId: ORG_A, productId: 'p1', quantity: 2, unitPrice: 50000, totalAmount: 100000 }],
    Product: [{ id: 'p1', name: 'Blue Dress', sku: 'BD-001', taxType: 'B' }],
    TaxInvoice: [],
    ...overrides,
  };
}

describe('tax-invoice generation', () => {
  beforeEach(() => {
    mockTables = baseTables();
  });

  it('generates a KRA-format invoice with correct VAT breakdown for a standard-rated item', async () => {
    const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
    await generateTaxInvoiceForSale(SALE_ID);

    const invoice = await getTaxInvoiceForSale(SALE_ID);
    expect(invoice).not.toBeNull();
    expect(invoice!.organizationId).toBe(ORG_A);
    expect(invoice!.kraPin).toBe('P000111222A');
    expect(invoice!.totalAmount).toBe(100000);
    // 100000 cents inclusive of 16% VAT -> tax = 100000 - 100000/1.16 ≈ 13793
    expect(invoice!.totalTaxAmount).toBeGreaterThan(13000);
    expect(invoice!.totalTaxAmount).toBeLessThan(14000);
    expect(invoice!.totalTaxableAmount).toBe(invoice!.totalAmount - invoice!.totalTaxAmount);
    expect(invoice!.itemsJson).toHaveLength(1);
    expect(invoice!.itemsJson[0].description).toBe('Blue Dress');
    expect(invoice!.qrCodeData).toBeTruthy();
  });

  it('skips silently when the org has no KRA PIN configured', async () => {
    mockTables = baseTables({
      SalesEntry: [{ id: 'sale-2', organizationId: ORG_B, productId: 'p1', quantity: 1, unitPrice: 1000, totalAmount: 1000 }],
    });
    const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
    await generateTaxInvoiceForSale('sale-2');
    expect(await getTaxInvoiceForSale('sale-2')).toBeNull();
  });

  it('tenant isolation: an invoice generated for org A is never returned for a sale belonging to org B', async () => {
    const { generateTaxInvoiceForSale } = await import('../tax-invoice.server');
    await generateTaxInvoiceForSale(SALE_ID);
    const orgBRows = mockTables.TaxInvoice.filter((r) => r.organizationId === ORG_B);
    expect(orgBRows).toHaveLength(0);
  });

  it('zero-rated items have no tax portion', async () => {
    mockTables = baseTables({
      Product: [{ id: 'p1', name: 'Bread', sku: 'BRD-001', taxType: 'C' }],
    });
    const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
    await generateTaxInvoiceForSale(SALE_ID);
    const invoice = await getTaxInvoiceForSale(SALE_ID);
    expect(invoice!.totalTaxAmount).toBe(0);
    expect(invoice!.totalTaxableAmount).toBe(invoice!.totalAmount);
  });
});
