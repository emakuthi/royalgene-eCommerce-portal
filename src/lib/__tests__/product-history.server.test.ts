import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../entitlements/__tests__/supabase-mock';

vi.mock('server-only', () => ({}));

let mockTables: MockTables;

vi.mock('../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

const ORG = 'org-1';
const PRODUCT = 'prod-1';

function edit(id: string, changes: Array<{ field: string; from: unknown; to: unknown }>) {
  return {
    id,
    organization_id: ORG,
    resource_type: 'product',
    resource_id: PRODUCT,
    user_id: 'user-1',
    action: 'product.update',
    details: { changes },
    created_at: '2026-10-15T20:58:00Z',
  };
}

describe('buildProductHistory cost redaction', () => {
  beforeEach(() => {
    mockTables = {
      Product: [{ id: PRODUCT, name: 'Dress', createdAt: '2026-09-29T08:59:00Z', organizationId: ORG }],
      ShopStock: [],
      Shop: [],
      StockTransaction: [],
      PortalUser: [],
      User: [{ id: 'user-1', name: 'Owner', email: 'o@x.com' }],
      activity_logs: [
        edit('a-cost-only', [{ field: 'costPrice', from: 0, to: 1400 }]),
        edit('a-mixed', [
          { field: 'price', from: 2000, to: 2500 },
          { field: 'costPrice', from: 1400, to: 1500 },
        ]),
      ],
    };
  });

  it('shows cost edits to callers who can view cost', async () => {
    const { buildProductHistory } = await import('../product-history.server');
    const events = (await buildProductHistory(ORG, PRODUCT, { includeCost: true }))!;
    const edits = events.filter((e) => e.type === 'edit');
    expect(edits.map((e) => e.id).sort()).toEqual(['a-cost-only', 'a-mixed']);
    expect(edits.find((e) => e.id === 'a-mixed')!.changes).toHaveLength(2);
  });

  it('hides cost values and cost-only edits from everyone else', async () => {
    const { buildProductHistory } = await import('../product-history.server');
    const events = (await buildProductHistory(ORG, PRODUCT, { includeCost: false }))!;
    const edits = events.filter((e) => e.type === 'edit');
    expect(edits.map((e) => e.id)).toEqual(['a-mixed']);
    expect(edits[0].changes).toEqual([{ field: 'price', from: '2000', to: '2500' }]);
    expect(edits[0].title).toBe('Updated price');
    expect(JSON.stringify(events)).not.toMatch(/costPrice|1400|1500/);
  });
});

describe('buildProductHistory stock labels', () => {
  const txn = (id: string, type: string, quantity: number, reason: string, reference: string | null, at: string) => ({
    id, shopStockId: 'ss-1', portalUserId: null, type, quantity, reason, reference, notes: null, size: '', color: '', createdAt: at,
  });

  beforeEach(() => {
    mockTables = {
      Product: [{ id: PRODUCT, name: 'Dress', createdAt: '2026-09-29T08:59:00Z', organizationId: ORG }],
      ShopStock: [{ id: 'ss-1', shopId: 'shop-1', productId: PRODUCT, organizationId: ORG, quantity: 10 }],
      Shop: [{ id: 'shop-1', name: 'Main Shop' }],
      StockTransaction: [
        // The formats each transfer route actually writes.
        txn('t-mobile-out', 'subtract', -2, 'Mobile transfer out to Town Shop — for a sale', 'mobile-transfer-abc', '2026-10-01T10:00:00Z'),
        txn('t-request-out', 'subtract', -1, 'Transfer confirmed to shop shop-2', 'transfer-request-xyz', '2026-10-02T10:00:00Z'),
        txn('t-portal-out', 'subtract', -1, 'Transfer out to shop Town Shop', 'transfer-2026-10-03', '2026-10-03T10:00:00Z'),
        txn('t-in', 'add', 3, 'Mobile transfer in from shop shop-2', 'mobile-transfer-def', '2026-10-04T10:00:00Z'),
        txn('t-sale', 'subtract', -1, 'Sale', 'sale-123', '2026-10-05T10:00:00Z'),
      ],
      PortalUser: [],
      User: [],
      activity_logs: [],
    };
  });

  it('labels transfers out as transfers, not sales', async () => {
    const { buildProductHistory } = await import('../product-history.server');
    const events = (await buildProductHistory(ORG, PRODUCT, { includeCost: true }))!;
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const id of ['t-mobile-out', 't-request-out', 't-portal-out']) {
      expect(byId.get(id)).toMatchObject({ type: 'transfer_out' });
      expect(byId.get(id)!.title).toMatch(/^Transferred out/);
    }
    expect(byId.get('t-in')).toMatchObject({ type: 'transfer_in', title: 'Transferred in 3' });
    expect(byId.get('t-sale')).toMatchObject({ type: 'sale', title: 'Sold 1' });
  });
});
