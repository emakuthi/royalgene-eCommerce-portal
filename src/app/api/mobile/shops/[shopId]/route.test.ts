import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockTables } from '@/lib/entitlements/__tests__/supabase-mock';

let mockTables: MockTables;
let payload: Record<string, unknown> | null;

vi.mock('@/lib/supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));
vi.mock('@/lib/auth.server', () => ({ verifyToken: () => payload }));
vi.mock('@/lib/deactivated-staff.server', () => ({ rejectIfDeactivated: async () => null }));
vi.mock('@/lib/shops.server', () => ({
  isShopNameAvailable: async (name: string, organizationId: string) =>
    !mockTables.Shop.some((s) =>
      String(s.name).toLowerCase() === name.toLowerCase() && s.organizationId === organizationId && s.isActive),
}));

const { PATCH } = await import('./route');

function rename(shopId: string, body: unknown) {
  const request = new NextRequest(`https://example.test/api/mobile/shops/${shopId}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ shopId }) });
}

const nameOf = (id: string) => mockTables.Shop.find((s) => s.id === id)?.name;

beforeEach(() => {
  payload = { userId: 'user-1', role: 'admin', organizationId: 'org-1' };
  mockTables = {
    Shop: [
      { id: 'shop-1', name: "Amina's Workspace", location: 'Main', phone: null, address: null, organizationId: 'org-1', isActive: true },
      { id: 'shop-2', name: 'Westlands', location: 'Westlands', phone: null, address: null, organizationId: 'org-1', isActive: true },
      { id: 'other', name: 'Theirs', location: 'Main', phone: null, address: null, organizationId: 'org-2', isActive: true },
      { id: 'closed', name: 'Closed', location: 'Main', phone: null, address: null, organizationId: 'org-1', isActive: false },
    ],
  };
});

describe('PATCH /api/mobile/shops/[shopId]', () => {
  it('renames the shop and trims the name', async () => {
    const response = await rename('shop-1', { name: '  Amina Boutique  ' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ id: 'shop-1', name: 'Amina Boutique', location: 'Main' });
    expect(nameOf('shop-1')).toBe('Amina Boutique');
  });

  it('refuses staff', async () => {
    payload = { userId: 'user-2', role: 'user', organizationId: 'org-1' };
    const response = await rename('shop-1', { name: 'Amina Boutique' });

    expect(response.status).toBe(403);
    expect(nameOf('shop-1')).toBe("Amina's Workspace");
  });

  it('refuses without a valid token', async () => {
    payload = null;
    expect((await rename('shop-1', { name: 'Amina Boutique' })).status).toBe(401);
  });

  it("can't reach another workspace's shop", async () => {
    const response = await rename('other', { name: 'Mine Now' });

    expect(response.status).toBe(404);
    expect(nameOf('other')).toBe('Theirs');
  });

  it("can't rename a closed shop", async () => {
    expect((await rename('closed', { name: 'Open Again' })).status).toBe(404);
  });

  it('refuses a name another shop here already uses', async () => {
    const response = await rename('shop-1', { name: 'westlands' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('DUPLICATE_NAME');
    expect(nameOf('shop-1')).toBe("Amina's Workspace");
  });

  it('allows a name used in another workspace', async () => {
    expect((await rename('shop-1', { name: 'Theirs' })).status).toBe(200);
  });

  it('allows changing only the capitals of its own name', async () => {
    expect((await rename('shop-2', { name: 'WESTLANDS' })).status).toBe(200);
    expect(nameOf('shop-2')).toBe('WESTLANDS');
  });

  it.each([[''], ['   '], ['A'], ['x'.repeat(101)], [42], [undefined]])('refuses the name %j', async (name) => {
    const response = await rename('shop-1', { name });

    expect(response.status).toBe(400);
    expect(nameOf('shop-1')).toBe("Amina's Workspace");
  });
});
