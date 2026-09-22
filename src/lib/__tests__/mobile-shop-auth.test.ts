import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// role: 'super_admin' makes assertTenantMatch (real, unmocked) short-circuit
// to null regardless of the x-org-id header — keeps this test focused on
// the device-revocation check, not tenant-header plumbing.
const basePayload = { userId: 'user-1', role: 'super_admin', organizationId: null as string | null };

const verifyTokenMock = vi.fn();
const isDeviceRevokedMock = vi.fn();

vi.mock('@/lib/auth.server', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

vi.mock('@/lib/device-registry.server', () => ({
  isDeviceRevoked: (...args: unknown[]) => isDeviceRevokedMock(...args),
}));

// A tiny in-memory PortalUser table behind the same chainable-builder shape
// the real supabase-js client exposes — lets resolveAdminPortalUserId's own
// .eq/.limit/.maybeSingle/.insert chain run against it unmodified.
let portalUsers: Array<{ id: string; userId: string; shopId: string; organizationId: string; position: string; isActive: boolean }> = [];
let shops: Array<{ id: string; organizationId: string }> = [];
let insertShouldConflict = false;

function chainable(table: 'PortalUser' | 'Shop') {
  const filters: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => { filters.push([col, val]); return q; };
  q.limit = () => q;
  q.maybeSingle = async () => {
    const rows = table === 'PortalUser' ? portalUsers : shops;
    const matched = rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
    return { data: matched[0] ?? null, error: null };
  };
  q.insert = (rows: Array<Record<string, unknown>>) => {
    const row = rows[0] as typeof portalUsers[number];
    const dup = portalUsers.some((r) => r.userId === row.userId && r.shopId === row.shopId);
    const insertObj: Record<string, unknown> = {};
    insertObj.select = () => insertObj;
    insertObj.single = async () => {
      if (insertShouldConflict || dup) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "PortalUser_userId_shopId_key"' } };
      }
      portalUsers.push(row);
      return { data: { id: row.id }, error: null };
    };
    return insertObj;
  };
  return q;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: (table: 'PortalUser' | 'Shop') => chainable(table) },
}));

import { verifyMobileAuth, verifyMobileShopAccess } from '../mobile-shop-auth';

function makeRequest() {
  return new NextRequest('http://localhost/api/mobile/whatever', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('verifyMobileAuth — device revocation', () => {
  it('proceeds normally when the token carries no deviceId claim (never checks revocation)', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload });

    const result = await verifyMobileAuth(makeRequest());

    expect(isDeviceRevokedMock).not.toHaveBeenCalled();
    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      expect(result.payload.userId).toBe('user-1');
    }
  });

  it('rejects with 401 DEVICE_REVOKED when the token’s device has been revoked', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload, deviceId: 'device-1' });
    isDeviceRevokedMock.mockResolvedValue(true);

    const result = await verifyMobileAuth(makeRequest());

    expect(isDeviceRevokedMock).toHaveBeenCalledWith('user-1', 'device-1');
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json.code).toBe('DEVICE_REVOKED');
    }
  });

  it('proceeds normally when the token carries a deviceId that is not revoked', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload, deviceId: 'device-1' });
    isDeviceRevokedMock.mockResolvedValue(false);

    const result = await verifyMobileAuth(makeRequest());

    expect(result).not.toBeInstanceOf(Response);
  });
});

describe('verifyMobileShopAccess — admin PortalUser resolution (multi-shop admin)', () => {
  const adminPayload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };

  function shopRequest(shopId: string) {
    return new NextRequest(`http://localhost/api/mobile/shops/${shopId}/whatever`, {
      headers: { authorization: 'Bearer test-token', 'x-org-id': 'org-1' },
    });
  }

  beforeEach(() => {
    portalUsers = [];
    shops = [{ id: 'shop-a', organizationId: 'org-1' }, { id: 'shop-b', organizationId: 'org-1' }, { id: 'shop-c', organizationId: 'org-1' }];
    insertShouldConflict = false;
    verifyTokenMock.mockReturnValue({ ...adminPayload });
  });

  it('reuses the PortalUser row already scoped to this shop instead of trying to insert a duplicate', async () => {
    // The real-world bug: an admin already has a PortalUser row for shop-a (e.g. a
    // named "shop_owner" row from before they became org admin) PLUS others for
    // shop-b/shop-c — three rows total for one userId.
    portalUsers = [
      { id: 'pu-a', userId: 'admin-1', shopId: 'shop-a', organizationId: 'org-1', position: 'shop_owner', isActive: true },
      { id: 'pu-b', userId: 'admin-1', shopId: 'shop-b', organizationId: 'org-1', position: 'admin', isActive: true },
      { id: 'pu-c', userId: 'admin-1', shopId: 'shop-c', organizationId: 'org-1', position: 'admin', isActive: true },
    ];

    const result = await verifyMobileShopAccess(shopRequest('shop-a'), 'shop-a');

    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      expect(result.portalUserId).toBe('pu-a');
    }
    // No new row created, no duplicate-key attempt.
    expect(portalUsers).toHaveLength(3);
  });

  it('reuses any existing row for the user when none is scoped to this shop', async () => {
    portalUsers = [{ id: 'pu-b', userId: 'admin-1', shopId: 'shop-b', organizationId: 'org-1', position: 'admin', isActive: true }];

    const result = await verifyMobileShopAccess(shopRequest('shop-c'), 'shop-c');

    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      expect(result.portalUserId).toBe('pu-b');
    }
  });

  it('lazily creates a PortalUser row scoped to this shop when the admin has none at all', async () => {
    const result = await verifyMobileShopAccess(shopRequest('shop-a'), 'shop-a');

    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      expect(portalUsers.find((r) => r.id === result.portalUserId)?.shopId).toBe('shop-a');
    }
  });
});
