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
