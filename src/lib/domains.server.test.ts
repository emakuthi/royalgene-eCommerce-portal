import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./tenant', () => ({ ROOT_DOMAIN: 'royaltrack.royalgenegroup.co.ke' }));

// The organization row the lookups return, the workspace already using a
// domain (if any), and every Organization update.
let org: { customDomain: string | null; customDomainStatus: string | null } | null;
let takenBy: { id: string } | null;
const updates: Array<Record<string, unknown>> = [];

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) c[m] = () => c;
  c.neq = () => chain(() => takenBy);
  c.maybeSingle = async () => ({ data: result(), error: null });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: result(), error: null });
  return c;
}

vi.mock('./supabase-client', () => ({
  supabaseAdmin: {
    from: () => ({
      ...chain(() => org),
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        if (org) org = { ...org, ...(values as typeof org) };
        return chain(() => null);
      },
    }),
  },
}));

let resolved: string[] | Error;
vi.mock('node:dns', () => ({
  promises: { resolve4: async () => { if (resolved instanceof Error) throw resolved; return resolved; } },
}));

import { refreshCustomDomainStatus, removeCustomDomain, setCustomDomain } from './domains.server';

const answersCheck = (body: string) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status: 200 }));
const unreachable = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

describe('custom domains on the VPS', () => {
  beforeEach(() => {
    org = { customDomain: null, customDomainStatus: null };
    takenBy = null;
    updates.length = 0;
    resolved = new Error('ENOTFOUND');
  });
  afterEach(() => vi.restoreAllMocks());

  it('saves a new domain as pending with the VPS records to add', async () => {
    unreachable();
    const state = await setCustomDomain('org-1', ' Shop.Example.com. ');
    expect(updates[0]).toMatchObject({ customDomain: 'shop.example.com', customDomainStatus: 'pending' });
    expect(state.instructions).toEqual({ cnameTarget: 'royaltrack.royalgenegroup.co.ke', aRecordTarget: '195.110.58.34', verification: [] });
    expect(state.status).toBe('misconfigured');
    expect(state.reachable).toBe(false);
  });

  it('refuses a RoyalTrack address and a domain another workspace uses', async () => {
    expect((await setCustomDomain('org-1', 'acme.royaltrack.royalgenegroup.co.ke')).error).toMatch(/already a RoyalTrack address/);
    takenBy = { id: 'org-2' };
    expect((await setCustomDomain('org-1', 'shop.example.com')).error).toMatch(/another workspace/);
    expect(updates).toHaveLength(0);
  });

  it('stays pending (certificate on its way) once the server answers the check', async () => {
    org = { customDomain: 'shop.example.com', customDomainStatus: 'misconfigured' };
    const fetchSpy = answersCheck('royaltrack-ok\n');
    const state = await refreshCustomDomainStatus('org-1');
    expect(fetchSpy).toHaveBeenCalledWith('http://shop.example.com/.well-known/acme-challenge/royaltrack-domain-check', expect.anything());
    expect(state).toMatchObject({ status: 'pending', reachable: true });
    expect(updates.at(-1)).toMatchObject({ customDomainStatus: 'pending' });
  });

  it("counts DNS pointing at the VPS when the server can't reach itself", async () => {
    org = { customDomain: 'shop.example.com', customDomainStatus: 'pending' };
    answersCheck('<html>someone else</html>');
    resolved = ['195.110.58.34'];
    expect(await refreshCustomDomainStatus('org-1')).toMatchObject({ status: 'pending', reachable: true });
    expect(updates).toHaveLength(0);
  });

  it('never downgrades a verified domain from inside the server', async () => {
    org = { customDomain: 'shop.example.com', customDomainStatus: 'verified' };
    unreachable();
    expect(await refreshCustomDomainStatus('org-1')).toMatchObject({ status: 'verified', reachable: false });
    expect(updates).toHaveLength(0);
  });

  it('removing only frees the domain (the VPS script removes the site)', async () => {
    org = { customDomain: 'shop.example.com', customDomainStatus: 'verified' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await removeCustomDomain('org-1')).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ customDomain: null, customDomainStatus: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
