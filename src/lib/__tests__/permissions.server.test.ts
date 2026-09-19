import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

type Row = Record<string, unknown>;

let portalUserRows: Row[] = [];
let rolePermissionRows: Row[] = [];

// A minimal chainable query-builder stand-in: each .eq() narrows the row set
// and returns itself (so chained eq()s work), while both .limit()/.maybeSingle()
// (explicit terminators) and bare `await` (via .then()) resolve from the
// same narrowed rows — covering every shape permissions.server.ts actually
// calls (see loadCallerPosition, hasCapability, getEffectivePermissions).
function queryBuilder(initialRows: Row[]) {
  let rows = initialRows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return builder;
    },
    limit: (_n: number) => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return builder;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'PortalUser') return queryBuilder(portalUserRows);
      if (table === 'RolePermission') return queryBuilder(rolePermissionRows);
      throw new Error(`permissions.server.test.ts: unexpected table "${table}"`);
    },
    // setPermissionOverride's upsert isn't exercised by these tests.
  },
}));

import { hasCapability, getEffectivePermissions, DEFAULT_PERMISSIONS } from '../permissions.server';

beforeEach(() => {
  portalUserRows = [];
  rolePermissionRows = [];
});

describe('hasCapability — owner bypass', () => {
  it('allows admin without any lookup, even for a capability everyone else is denied', async () => {
    expect(await hasCapability({ userId: 'u1', role: 'admin' }, 'view_cost_price')).toBe(true);
  });

  it('allows super_admin', async () => {
    expect(await hasCapability({ userId: 'u1', role: 'super_admin' }, 'manage_staff')).toBe(true);
  });

  it('allows a portal_user whose active position is shop_owner, for every capability', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'shop_owner' }];
    const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org1' };
    expect(await hasCapability(payload, 'view_cost_price')).toBe(true);
    expect(await hasCapability(payload, 'manage_staff')).toBe(true);
  });

  it('allows the legacy "owner" position spelling', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'owner' }];
    expect(await hasCapability({ userId: 'u1', role: 'portal_user', organizationId: 'org1' }, 'delete_inventory')).toBe(true);
  });
});

describe('hasCapability — editable roles', () => {
  it('falls back to DEFAULT_PERMISSIONS when there is no override row', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'shop_manager' }];
    const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org1' };
    expect(await hasCapability(payload, 'view_cost_price')).toBe(DEFAULT_PERMISSIONS.shop_manager.view_cost_price);
    expect(await hasCapability(payload, 'add_inventory')).toBe(DEFAULT_PERMISSIONS.shop_manager.add_inventory);
  });

  it('an override row wins over the default', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'shop_manager' }];
    rolePermissionRows = [{ organizationId: 'org1', role: 'shop_manager', permission: 'view_cost_price', enabled: true }];
    const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org1' };
    expect(await hasCapability(payload, 'view_cost_price')).toBe(true);
  });

  it('normalizes the legacy "manager"/"staff" position spellings', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'manager' }];
    const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org1' };
    expect(await hasCapability(payload, 'add_inventory')).toBe(DEFAULT_PERMISSIONS.shop_manager.add_inventory);
  });

  it('denies when the caller has no active portal membership at all', async () => {
    portalUserRows = [];
    expect(await hasCapability({ userId: 'u1', role: 'portal_user', organizationId: 'org1' }, 'record_sales')).toBe(false);
  });

  it('denies a non-owner caller with no organizationId', async () => {
    portalUserRows = [{ userId: 'u1', isActive: true, position: 'shopkeeper' }];
    expect(await hasCapability({ userId: 'u1', role: 'portal_user', organizationId: null }, 'record_sales')).toBe(false);
  });
});

describe('getEffectivePermissions', () => {
  it('returns pure defaults for an org with no overrides', async () => {
    const matrix = await getEffectivePermissions('org1');
    expect(matrix).toEqual(DEFAULT_PERMISSIONS);
  });

  it('applies an override to only its own role+permission cell', async () => {
    rolePermissionRows = [{ organizationId: 'org1', role: 'shopkeeper', permission: 'add_inventory', enabled: true }];
    const matrix = await getEffectivePermissions('org1');
    expect(matrix.shopkeeper.add_inventory).toBe(true);
    expect(matrix.shopkeeper.view_cost_price).toBe(DEFAULT_PERMISSIONS.shopkeeper.view_cost_price);
    expect(matrix.cashier).toEqual(DEFAULT_PERMISSIONS.cashier);
  });
});
