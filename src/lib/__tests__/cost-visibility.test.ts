import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rows the mocked PortalUser lookup returns for the caller under test.
let portalUserRows: Array<{ position: string }> = [];

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: portalUserRows, error: null }),
        }),
      }),
    }),
  },
}));

import { canViewCostData, redactCostFields } from '../cost-visibility.server';

beforeEach(() => {
  portalUserRows = [];
});

describe('canViewCostData', () => {
  it('allows the workspace admin without any lookup', async () => {
    portalUserRows = [{ position: 'shopkeeper' }]; // would say no — role wins first
    expect(await canViewCostData({ userId: 'u1', role: 'admin' })).toBe(true);
  });

  it('allows super_admin', async () => {
    expect(await canViewCostData({ userId: 'u1', role: 'super_admin' })).toBe(true);
  });

  it('allows a portal_user whose active position is shop_owner', async () => {
    portalUserRows = [{ position: 'shop_owner' }];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(true);
  });

  it('allows the legacy "owner" position spelling', async () => {
    portalUserRows = [{ position: 'owner' }];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(true);
  });

  it('denies a shopkeeper', async () => {
    portalUserRows = [{ position: 'shopkeeper' }];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(false);
  });

  it('denies a shop_manager — managing a shop is not owning it', async () => {
    portalUserRows = [{ position: 'shop_manager' }];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(false);
  });

  it('allows someone who owns one shop while only staffing another', async () => {
    portalUserRows = [{ position: 'cashier' }, { position: 'shop_owner' }];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(true);
  });

  it('denies when the caller has no portal membership at all', async () => {
    portalUserRows = [];
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' })).toBe(false);
  });
});

describe('redactCostFields', () => {
  it('nulls costPrice on a Product row without dropping the key', () => {
    const out = redactCostFields('Product', { id: 'p1', price: 6500, costPrice: 3000 });
    expect(out).toEqual({ id: 'p1', price: 6500, costPrice: null });
  });

  it('leaves entities with no cost fields untouched', () => {
    const row = { id: 's1', name: 'Main' };
    expect(redactCostFields('Shop', row)).toBe(row);
  });

  it('does not mutate the row it was given', () => {
    const row = { id: 'p1', costPrice: 3000 };
    redactCostFields('Product', row);
    expect(row.costPrice).toBe(3000);
  });
});
