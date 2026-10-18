import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../../entitlements/__tests__/supabase-mock';

// One QuickBooks SalesReceipt per checkout: the first synced line of a
// saleGroupId creates it, later lines are added to it.

const ORG = 'org-1';
const GROUP = '7b0c5e0a-1111-4222-8333-944444444444';

let mockTables: MockTables;
vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));
vi.mock('../../entitlements/entitlement-service.server', () => ({ hasFeature: vi.fn(async () => true) }));
vi.mock('../../integrations/quickbooks-connection.server', () => ({
  getValidAccessToken: vi.fn(async () => ({ realmId: 'realm', accessToken: 'token' })),
}));

const createSalesReceipt = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, salesReceiptId: 'r1' }));
const addLineToSalesReceipt = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, salesReceiptId: 'r1' }));
vi.mock('../quickbooks.server', () => ({
  findOrCreateItem: vi.fn(async () => ({ ok: true, itemId: 'item-1' })),
  createSalesReceipt: (...args: unknown[]) => createSalesReceipt(...args),
  addLineToSalesReceipt: (...args: unknown[]) => addLineToSalesReceipt(...args),
}));

import { syncSaleToQuickBooks } from '../sync-sale-to-quickbooks.server';

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: ORG, productId: 'p1', quantity: 1, unitPrice: 50000, totalAmount: 50000, ...extra,
});

beforeEach(() => {
  createSalesReceipt.mockClear();
  addLineToSalesReceipt.mockClear();
  mockTables = {
    SalesEntry: [line('line-1', { saleGroupId: GROUP }), line('line-2', { saleGroupId: GROUP }), line('solo')],
    Product: [{ id: 'p1', name: 'Blue Dress', sku: 'BD-001' }],
    AccountingSyncLog: [],
  };
});

describe('syncSaleToQuickBooks', () => {
  it('creates a receipt for the first line of a checkout and adds later lines to it', async () => {
    await syncSaleToQuickBooks('line-1');
    await syncSaleToQuickBooks('line-2');

    expect(createSalesReceipt).toHaveBeenCalledTimes(1);
    expect(addLineToSalesReceipt).toHaveBeenCalledTimes(1);
    expect(addLineToSalesReceipt.mock.calls[0][2]).toBe('r1');
    expect(mockTables.AccountingSyncLog.map((l) => [l.salesEntryId, l.status, l.externalId])).toEqual([
      ['line-1', 'synced', 'r1'],
      ['line-2', 'synced', 'r1'],
    ]);
  });

  it('gives a sale without a saleGroupId its own receipt', async () => {
    await syncSaleToQuickBooks('line-1');
    await syncSaleToQuickBooks('solo');

    expect(createSalesReceipt).toHaveBeenCalledTimes(2);
    expect(addLineToSalesReceipt).not.toHaveBeenCalled();
  });
});
