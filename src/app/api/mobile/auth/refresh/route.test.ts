import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const payload = { userId: 'u1', role: 'portal_user', organizationId: 'org-1' };
let user: Record<string, unknown> | null = { id: 'u1', email: 'a@b.co', role: 'portal_user', organizationId: 'org-1' };
let portalRows: Array<{ isActive: boolean }> = [];

vi.mock('@/lib/auth.server', () => ({
  extractTokenFromHeader: () => 'token',
  verifyToken: () => payload,
  signAuthToken: () => 'fresh-token',
}));
vi.mock('@/lib/device-registry.server', () => ({ isDeviceRevoked: async () => false }));
vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, _val: string) => (table === 'User'
          ? { maybeSingle: async () => ({ data: user, error: null }) }
          : Promise.resolve({ data: portalRows, error: null })),
      }),
    }),
  },
}));

import { POST } from './route';

const call = () => POST(new NextRequest('http://localhost/api/mobile/auth/refresh', { method: 'POST' }));

beforeEach(() => {
  user = { id: 'u1', email: 'a@b.co', role: 'portal_user', organizationId: 'org-1' };
  portalRows = [{ isActive: true }];
});

describe('POST /api/mobile/auth/refresh', () => {
  it('renews active staff', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data.token).toBe('fresh-token');
  });

  it('refuses a deactivated person, so the app returns to sign-in', async () => {
    portalRows = [{ isActive: false }];
    const response = await call();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('still renews an owner whose own staff row is inactive', async () => {
    user = { ...user, role: 'admin' };
    portalRows = [{ isActive: false }];
    expect((await call()).status).toBe(200);
  });
});
