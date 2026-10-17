import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A read-only workspace can still read and sign in, but every other change
// is refused with 402 READ_ONLY (which the Android sync keeps queued).

const state = { org: null as Record<string, unknown> | null };
vi.mock('@/lib/tenant', async (orig) => {
  const real = await orig<typeof import('@/lib/tenant')>();
  return {
    ...real,
    extractSubdomain: () => 'acme',
    resolveOrganizationEdge: async () => state.org,
  };
});

import { middleware } from '@/middleware';

const call = (method: string, path: string) =>
  middleware(new NextRequest(`http://acme.localhost:3001${path}`, { method, headers: { host: 'acme.localhost:3001' } }));

beforeEach(() => {
  state.org = { id: 'org-1', slug: 'acme', status: 'active', planTier: 'free', trialEndsAt: '2020-01-01T00:00:00Z', billingStatus: null, paidThrough: null };
});

describe('middleware read-only gate', () => {
  it('lets reads through', async () => {
    const res = await call('GET', '/api/portal/sales');
    expect(res.status).not.toBe(402);
  });

  it('refuses a new sale with READ_ONLY', async () => {
    const res = await call('POST', '/api/mobile/shops/s1/sales');
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.code).toBe('READ_ONLY');
    expect(json.reason).toBe('trial_ended');
  });

  it('still allows signing in and paying', async () => {
    expect((await call('POST', '/api/portal/auth/login')).status).not.toBe(402);
    expect((await call('POST', '/api/portal/billing/checkout')).status).not.toBe(402);
    expect((await call('POST', '/api/mobile/auth/refresh')).status).not.toBe(402);
  });

  it('leaves the website pages open', async () => {
    const res = await call('GET', '/dashboard');
    expect(res.status).not.toBe(402);
    expect(res.headers.get('x-middleware-rewrite') ?? '').not.toContain('/trial-expired');
  });

  it('does not touch a workspace with full use', async () => {
    state.org = { ...state.org!, trialEndsAt: '2099-01-01T00:00:00Z' };
    expect((await call('POST', '/api/mobile/shops/s1/sales')).status).not.toBe(402);
  });
});
