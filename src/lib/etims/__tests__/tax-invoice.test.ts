import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables, type MockRpcHandlers } from '../../entitlements/__tests__/supabase-mock';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PLAN_ID = 'plan-1';
const SALE_ID = 'sale-1';

let mockTables: MockTables;

// Mirrors append_tax_invoice_line() in 20261018_02_tax_invoice_per_checkout.sql.
const rpcHandlers: MockRpcHandlers = {
  append_tax_invoice_line: (args, tables) => {
    const inv = (tables.TaxInvoice ?? []).find((r) => r.id === args.p_invoice_id) as Record<string, unknown> | undefined;
    if (!inv) return false;
    const ids = (inv.salesEntryIds as string[]) ?? [];
    if (ids.includes(args.p_sales_entry_id as string)) return false;
    inv.itemsJson = [...(inv.itemsJson as unknown[]), args.p_item];
    inv.salesEntryIds = [...ids, args.p_sales_entry_id];
    inv.totalTaxableAmount = (inv.totalTaxableAmount as number) + (args.p_taxable as number);
    inv.totalTaxAmount = (inv.totalTaxAmount as number) + (args.p_tax as number);
    inv.totalAmount = (inv.totalAmount as number) + (args.p_total as number);
    return true;
  },
};

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables, rpcHandlers);
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

  describe('multi-item checkout (saleGroupId)', () => {
    const GROUP = '7b0c5e0a-1111-4222-8333-944444444444';
    const lines = [
      { id: 'line-1', organizationId: ORG_A, productId: 'p1', quantity: 1, unitPrice: 50000, totalAmount: 50000, saleGroupId: GROUP },
      { id: 'line-2', organizationId: ORG_A, productId: 'p2', quantity: 2, unitPrice: 10000, totalAmount: 20000, saleGroupId: GROUP },
      { id: 'line-3', organizationId: ORG_A, productId: 'p1', quantity: 1, unitPrice: 50000, totalAmount: 50000, saleGroupId: GROUP },
    ];

    beforeEach(() => {
      let nextId = 0;
      mockTables = baseTables({
        SalesEntry: lines.map((l) => ({ ...l })),
        Product: [
          { id: 'p1', name: 'Blue Dress', sku: 'BD-001', taxType: 'B' },
          { id: 'p2', name: 'Scarf', sku: 'SC-001', taxType: 'A' },
        ],
      });
      // A real insert gets a DB-generated uuid; give mock rows one so the rpc can find them.
      const invoices = mockTables.TaxInvoice;
      Object.defineProperty(mockTables, 'TaxInvoice', {
        configurable: true,
        get: () => invoices,
        set: (rows: Record<string, unknown>[]) => {
          for (const r of rows) if (!r.id) r.id = `inv-${++nextId}`;
          invoices.splice(0, invoices.length, ...rows);
        },
      });
    });

    it('puts every line of the checkout on one invoice with summed totals', async () => {
      const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
      for (const l of lines) await generateTaxInvoiceForSale(l.id);

      expect(mockTables.TaxInvoice).toHaveLength(1);
      const inv = await getTaxInvoiceForSale('line-3');
      expect(inv).not.toBeNull();
      expect(inv!.itemsJson.map((i) => i.description)).toEqual(['Blue Dress', 'Scarf', 'Blue Dress']);
      expect(inv!.totalAmount).toBe(120000);
      // Scarf is exempt (A): only the two dresses carry VAT.
      const dressTax = 50000 - Math.round(50000 - 50000 / 1.16);
      expect(inv!.totalTaxableAmount).toBe(dressTax * 2 + 20000);
      expect(inv!.totalTaxableAmount + inv!.totalTaxAmount).toBe(120000);
      expect((inv as unknown as { salesEntryIds: string[] }).salesEntryIds).toEqual(['line-1', 'line-2', 'line-3']);
    });

    it('returns the same shared invoice for every line', async () => {
      const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
      for (const l of lines) await generateTaxInvoiceForSale(l.id);
      const numbers = await Promise.all(lines.map(async (l) => (await getTaxInvoiceForSale(l.id))!.invoiceNumber));
      expect(new Set(numbers).size).toBe(1);
    });

    it('does not add a line twice when its invoice generation is retried', async () => {
      const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
      await generateTaxInvoiceForSale('line-1');
      await generateTaxInvoiceForSale('line-2');
      await generateTaxInvoiceForSale('line-2');
      const inv = await getTaxInvoiceForSale('line-1');
      expect(inv!.itemsJson).toHaveLength(2);
      expect(inv!.totalAmount).toBe(70000);
    });

    it('still gives a sale without a saleGroupId its own invoice', async () => {
      mockTables.SalesEntry.push({ id: 'solo', organizationId: ORG_A, productId: 'p1', quantity: 1, unitPrice: 50000, totalAmount: 50000 });
      const { generateTaxInvoiceForSale, getTaxInvoiceForSale } = await import('../tax-invoice.server');
      await generateTaxInvoiceForSale('line-1');
      await generateTaxInvoiceForSale('solo');
      expect(mockTables.TaxInvoice).toHaveLength(2);
      expect((await getTaxInvoiceForSale('solo'))!.itemsJson).toHaveLength(1);
    });
  });
});
