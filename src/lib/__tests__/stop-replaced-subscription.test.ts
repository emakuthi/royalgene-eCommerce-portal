import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const fetchSubscription = vi.fn();
const disableSubscription = vi.fn();
vi.mock('../paystack.server', () => ({
  fetchSubscription: (...a: unknown[]) => fetchSubscription(...a),
  disableSubscription: (...a: unknown[]) => disableSubscription(...a),
}));
vi.mock('../entitlements/tenant-subscription-store.server', () => ({ upsertTenantSubscription: vi.fn() }));
vi.mock('../logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const inserts: unknown[] = [];
const updates: { patch: unknown; filters: [string, unknown][] }[] = [];
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (rows: unknown) => { inserts.push(rows); return Promise.resolve({ error: null }); },
      update: (patch: unknown) => {
        const entry = { patch, filters: [] as [string, unknown][] };
        updates.push(entry);
        const chain = { eq: (col: string, val: unknown) => { entry.filters.push([col, val]); return chain; }, then: (r: (v: unknown) => void) => r({ error: null }) };
        return chain;
      },
    }),
  },
}));

import { stopReplacedSubscription } from '../billing.server';

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
});

describe('stopReplacedSubscription', () => {
  it('stops the old card subscription and forgets its code', async () => {
    fetchSubscription.mockResolvedValue({ ok: true, data: { subscription_code: 'SUB_old', email_token: 'tok', status: 'active' } });
    disableSubscription.mockResolvedValue({ ok: true });
    await stopReplacedSubscription('org-1', 'SUB_old', 'SUB_new');
    expect(disableSubscription).toHaveBeenCalledWith('SUB_old', 'tok');
    expect(updates).toEqual([{ patch: { paystackSubscriptionCode: null }, filters: [['id', 'org-1'], ['paystackSubscriptionCode', 'SUB_old']] }]);
    expect(JSON.stringify(inserts)).toContain('subscription.replaced');
  });

  it('does nothing without an old code, or when it is the new subscription itself', async () => {
    await stopReplacedSubscription('org-1', null, 'SUB_new');
    await stopReplacedSubscription('org-1', 'SUB_new', 'SUB_new');
    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("doesn't try to disable one that already stopped charging", async () => {
    fetchSubscription.mockResolvedValue({ ok: true, data: { subscription_code: 'SUB_old', email_token: 'tok', status: 'cancelled' } });
    await stopReplacedSubscription('org-1', 'SUB_old', null);
    expect(disableSubscription).not.toHaveBeenCalled();
  });

  it('records a failure for follow-up instead of throwing', async () => {
    fetchSubscription.mockResolvedValue({ ok: true, data: { subscription_code: 'SUB_old', email_token: 'tok', status: 'active' } });
    disableSubscription.mockResolvedValue({ ok: false, error: 'Paystack down' });
    await expect(stopReplacedSubscription('org-1', 'SUB_old', null)).resolves.toBeUndefined();
    expect(JSON.stringify(inserts)).toContain('subscription.replace_failed');
  });
});
