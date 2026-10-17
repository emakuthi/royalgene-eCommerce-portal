import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import bcryptjs from 'bcryptjs';

// The main address belongs to the default tenant, but people from every
// workspace sign in there. A right password for another workspace's account
// used to come back as "Invalid credentials"; it now hands the browser to
// that workspace's own address.

vi.mock('@/lib/auth.server', () => ({ signAuthToken: vi.fn(() => 'signed-token') }));
vi.mock('@/lib/tenant', () => ({
  ROOT_DOMAIN: 'localhost:3001',
  isRootDomainHost: (host: string | null) => host === 'localhost:3001',
}));

const hash = bcryptjs.hashSync('right-password', 4);
const state = {
  scoped: null as Record<string, unknown> | null,
  others: [] as Record<string, unknown>[],
  org: { slug: 'acme', customDomain: null, customDomainStatus: null } as Record<string, unknown> | null,
};

function chain(single: () => unknown, all: () => unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'is', 'not', 'neq', 'update']) obj[m] = vi.fn(() => obj);
  obj.maybeSingle = vi.fn(async () => single());
  obj.single = vi.fn(async () => single());
  (obj as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(all()).then(res, rej);
  return obj;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'User') return chain(() => ({ data: state.scoped, error: null }), () => ({ data: state.others, error: null }));
      if (table === 'Organization') return chain(() => ({ data: state.org, error: null }), () => ({ data: null, error: null }));
      return chain(() => ({ data: null, error: null }), () => ({ data: null, error: null }));
    }),
  },
}));

import { POST } from './route';

const login = (host: string, orgId: string, password = 'right-password') => POST(new NextRequest(`http://${host}/api/portal/auth/login`, {
  method: 'POST',
  headers: { host, 'x-org-id': orgId, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'Owner@Acme.test', password }),
}));

const account = (organizationId: string) => ({ id: `u-${organizationId}`, email: 'owner@acme.test', name: 'Owner', role: 'admin', organizationId, password: hash });

beforeEach(() => {
  state.scoped = null;
  state.others = [];
  state.org = { slug: 'acme', customDomain: null, customDomainStatus: null };
});

describe('POST /api/portal/auth/login', () => {
  it('signs a default-tenant account straight in on the main address', async () => {
    state.scoped = account('org-default');
    const res = await login('localhost:3001', 'org-default');
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.token).toBe('signed-token');
    expect(json.data.redirectUrl).toBeNull();
  });

  it('hands another workspace account on the main address to its own address', async () => {
    state.others = [account('org-acme')];
    const res = await login('localhost:3001', 'org-default');
    const json = await res.json();
    expect(res.status).toBe(200);
    const url = new URL(json.data.redirectUrl);
    expect(url.host).toBe('acme.localhost:3001');
    expect(url.pathname).toBe('/session-bridge');
    expect(url.searchParams.get('token')).toBe('signed-token');
  });

  it('still rejects a wrong password for another workspace account', async () => {
    state.others = [account('org-acme')];
    const res = await login('localhost:3001', 'org-default', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('does not guess when the email matches more than one other workspace', async () => {
    state.others = [account('org-acme'), account('org-beta')];
    const res = await login('localhost:3001', 'org-default');
    expect(res.status).toBe(401);
  });

  it('keeps a workspace address scoped to its own workspace', async () => {
    state.others = [account('org-acme')];
    const res = await login('beta.localhost:3001', 'org-beta');
    expect(res.status).toBe(401);
  });
});
