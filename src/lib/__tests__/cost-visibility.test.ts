import { describe, it, expect, vi } from 'vitest';

// canViewCostData is now a thin forward to permissions.server.ts's
// hasCapability('view_cost_price') — see permissions.server.test.ts for the
// actual owner-bypass / override / default-fallback behaviour it exercises.
const hasCapability = vi.fn(async (_payload: unknown, _capability: unknown) => true);
vi.mock('@/lib/permissions.server', () => ({
  hasCapability: (payload: unknown, capability: unknown) => hasCapability(payload, capability),
}));

import { canViewCostData, redactCostFields } from '../cost-visibility.server';

describe('canViewCostData', () => {
  it('forwards to hasCapability with the view_cost_price capability', async () => {
    const payload = { userId: 'u1', role: 'admin' };
    await canViewCostData(payload as never);
    expect(hasCapability).toHaveBeenCalledWith(payload, 'view_cost_price');
  });

  it('returns whatever hasCapability decides', async () => {
    hasCapability.mockResolvedValueOnce(false);
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' } as never)).toBe(false);
    hasCapability.mockResolvedValueOnce(true);
    expect(await canViewCostData({ userId: 'u1', role: 'portal_user' } as never)).toBe(true);
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
