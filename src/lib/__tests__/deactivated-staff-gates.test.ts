import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The two shared gates: signing in, and every shop or plain mobile request.

const state = {
  payload: { userId: 'u1', role: 'portal_user', organizationId: 'org-1' } as Record<string, unknown>,
  user: { id: 'u1', role: 'portal_user', organizationId: 'org-1' } as Record<string, unknown>,
  portalRows: [] as Array<{ isActive: boolean }>,
};

vi.mock('@/lib/auth.server', () => ({
  verifyToken: () => state.payload,
  signAuthToken: () => 'token',
}));
vi.mock('@/lib/device-registry.server', () => ({ isDeviceRevoked: async () => false, registerDevice: async () => {} }));
vi.mock('@/lib/tenant-guard', () => ({ assertTenantMatch: () => null }));
vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => (table === 'User'
          ? { maybeSingle: async () => ({ data: state.user, error: null }) }
          : Promise.resolve({ data: state.portalRows, error: null })),
      }),
    }),
  },
}));

import { buildMobileAuthResponse } from '@/lib/mobile-auth-response.server';
import { verifyMobileAuth, verifyMobileShopAccess } from '@/lib/mobile-shop-auth';

const request = () => new NextRequest('http://localhost/api/mobile/x', { headers: { Authorization: 'Bearer t' } });

beforeEach(() => {
  state.payload = { userId: 'u1', role: 'portal_user', organizationId: 'org-1' };
  state.user = { id: 'u1', role: 'portal_user', organizationId: 'org-1' };
  state.portalRows = [{ isActive: false }];
});

describe('deactivated staff', () => {
  it('cannot sign in, and are told why', async () => {
    const result = await buildMobileAuthResponse('u1');
    expect(result).toEqual({ ok: false, error: 'This account has been deactivated. Contact your administrator.' });
  });

  it('are refused on shop requests with a token they already hold', async () => {
    const result = await verifyMobileShopAccess(request(), 'shop-1');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(((await (result as Response).json()) as { code: string }).code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('are refused on plain mobile requests too', async () => {
    const result = await verifyMobileAuth(request());
    expect((result as Response).status).toBe(401);
  });

  it('leaves active staff alone on plain mobile requests', async () => {
    state.portalRows = [{ isActive: true }];
    const result = await verifyMobileAuth(request());
    expect(result).not.toBeInstanceOf(Response);
  });
});
