import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockTables } from '@/lib/entitlements/__tests__/supabase-mock';

let mockTables: MockTables;
let role: string;

vi.mock('@/lib/supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));
vi.mock('@/lib/authorize', () => ({
  requireTenantUser: () => ({ userId: 'user-1', role, organizationId: 'org-1' }),
}));

const { PATCH } = await import('./route');

function update(shopId: string, body: unknown) {
  const request = new NextRequest(`https://example.test/api/portal/shops/${shopId}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ shopId }) });
}

const shop = (id: string) => mockTables.Shop.find((s) => s.id === id);

beforeEach(() => {
  role = 'admin';
  mockTables = {
    Shop: [
      { id: 'shop-1', name: 'Main', isActive: true, organizationId: 'org-1' },
      { id: 'other', name: 'Theirs', isActive: true, organizationId: 'org-2' },
    ],
  };
});

describe('PATCH /api/portal/shops/[shopId]', () => {
  it.each(['user', 'manager', 'shopkeeper'])('refuses the %s role and changes nothing', async (staffRole) => {
    role = staffRole;
    const response = await update('shop-1', { name: 'Renamed', isActive: false });

    expect(response.status).toBe(403);
    expect(shop('shop-1')).toMatchObject({ name: 'Main', isActive: true });
  });

  it.each(['admin', 'super_admin'])('lets %s update the shop', async (adminRole) => {
    role = adminRole;
    const response = await update('shop-1', { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(shop('shop-1')?.name).toBe('Renamed');
  });

  it("can't reach another workspace's shop", async () => {
    const response = await update('other', { name: 'Mine Now' });

    expect(response.status).toBe(404);
    expect(shop('other')?.name).toBe('Theirs');
  });
});
