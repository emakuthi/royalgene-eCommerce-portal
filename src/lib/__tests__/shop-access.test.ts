import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

let portalRows: Array<Record<string, unknown>> = [];
const shopNames: Record<string, string> = { 's-a': 'ELIANA FASHIONS', 's-b': 'Royalgene Collection', 's-c': 'Town Shop' };
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { filters[k] = v; return q; };
      q.maybeSingle = async () => ({ data: table === 'Shop' ? { name: shopNames[filters.id as string] } : null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: portalRows });
      return q;
    },
  },
}));

import { assignedShops, denyUnlessShopAllowed } from '../shop-access.server';

const staff = { userId: 'u1', role: 'portal_user', organizationId: 'org' };

beforeEach(() => { portalRows = []; });

describe('assignedShops', () => {
  it('admins see every shop', async () => {
    expect(await assignedShops({ ...staff, role: 'admin' })).toBeNull();
  });

  it.each(['shop_manager', 'manager', 'shop_owner', 'owner'])('%s sees every shop', async (position) => {
    portalRows = [{ shopId: 's-a', position, shop: { id: 's-a', name: 'ELIANA FASHIONS' } }];
    expect(await assignedShops(staff)).toBeNull();
  });

  it('a shopkeeper gets only the shops they are assigned to', async () => {
    portalRows = [
      { shopId: 's-a', position: 'shopkeeper', shop: { id: 's-a', name: 'ELIANA FASHIONS' } },
      { shopId: 's-c', position: 'cashier', shop: { id: 's-c', name: 'Town Shop' } },
    ];
    expect(await assignedShops(staff)).toEqual([{ id: 's-a', name: 'ELIANA FASHIONS' }, { id: 's-c', name: 'Town Shop' }]);
  });
});

describe('denyUnlessShopAllowed', () => {
  it("lets a shopkeeper into their own shop", async () => {
    portalRows = [{ shopId: 's-a', position: 'shopkeeper', shop: { id: 's-a', name: 'ELIANA FASHIONS' } }];
    expect(await denyUnlessShopAllowed(staff, 's-a')).toBeNull();
  });

  it('refuses another shop, saying which shop and which ones they have', async () => {
    portalRows = [{ shopId: 's-a', position: 'shopkeeper', shop: { id: 's-a', name: 'ELIANA FASHIONS' } }];
    const res = await denyUnlessShopAllowed(staff, 's-b');
    expect(res?.status).toBe(403);
    const json = await res!.json();
    expect(json.code).toBe('SHOP_ACCESS_DENIED');
    expect(json.error).toBe("You don't have access to Royalgene Collection. You can only access ELIANA FASHIONS. Ask the business owner to add you to Royalgene Collection if you need it.");
    expect(json.allowedShops).toEqual([{ id: 's-a', name: 'ELIANA FASHIONS' }]);
  });

  it('explains when the user has no shop at all', async () => {
    const json = await (await denyUnlessShopAllowed(staff, 's-b'))!.json();
    expect(json.error).toMatch(/aren't assigned to any shop yet/);
  });
});
