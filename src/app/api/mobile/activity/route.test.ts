import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const verifyTokenMock = vi.fn();
vi.mock('@/lib/auth.server', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertFeatureEnabled: vi.fn(async () => null),
}));

// activity_logs rows the "team" scenario resolves against — three different
// actors in the same org, one row each, so a query that isn't actually
// filtering by org membership would return all three regardless.
const activityRows = [
  { id: 'log-1', user_id: 'admin-1', user_email: 'admin@co.com', action: 'auth.login', category: 'auth', source: 'mobile', status: 'success', created_at: '2026-09-22T10:00:00Z', details: { deviceName: 'Pixel 7', platform: 'android' } },
  { id: 'log-2', user_id: 'staff-1', user_email: 'staff@co.com', action: 'sale.record', category: 'sale', source: 'mobile', status: 'success', created_at: '2026-09-22T09:00:00Z', details: {} },
  { id: 'log-3', user_id: 'outsider-1', user_email: 'outsider@other.com', action: 'auth.login', category: 'auth', source: 'mobile', status: 'success', created_at: '2026-09-22T08:00:00Z', details: {} },
];
const orgUsers = [{ id: 'admin-1' }, { id: 'staff-1' }]; // outsider-1 is NOT a member of org-1

let lastUserInFilter: string[] | undefined;
let lastUserEqFilter: string | undefined;

function chainable(table: string) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => {
    if (table === 'activity_logs' && col === 'user_id') lastUserEqFilter = val as string;
    return q;
  };
  q.order = () => q;
  q.range = () => q;
  q.in = (col: string, vals: string[]) => {
    if (table === 'activity_logs' && col === 'user_id') lastUserInFilter = vals;
    return q;
  };
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
    if (table === 'User') return Promise.resolve({ data: orgUsers, error: null }).then(resolve);
    if (table === 'activity_logs') {
      const rows = lastUserInFilter
        ? activityRows.filter((r) => lastUserInFilter!.includes(r.user_id))
        : activityRows.filter((r) => r.user_id === lastUserEqFilter);
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve);
    }
    return Promise.resolve({ data: null, error: null }).then(resolve);
  };
  return q;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'User') {
        // Two distinct call shapes share this mock: resolving org members
        // (.eq('organizationId', ...)) and resolving actor names (.in('id', ...)).
        const q: Record<string, unknown> = {};
        q.select = (cols: string) => {
          if (cols.includes('name')) {
            const byId: Record<string, unknown> = {};
            q.in = (_col: string, ids: string[]) => {
              (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: ids.map((id) => ({ id, name: id === 'admin-1' ? 'Ada Admin' : id === 'staff-1' ? 'Sam Staff' : null })),
                  error: null,
                }).then(resolve);
              return q;
            };
            return q;
          }
          return chainable('User');
        };
        return q;
      }
      return chainable(table);
    },
  },
}));

import { GET } from './route';

function request(qs = '') {
  return new NextRequest(`http://localhost/api/mobile/activity${qs}`, {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/mobile/activity — scope', () => {
  beforeEach(() => {
    lastUserInFilter = undefined;
    lastUserEqFilter = undefined;
  });

  it('a non-admin only ever sees their own rows, even if they pass scope params', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' });

    const res = await GET(request());
    const json = await res.json();

    expect(lastUserInFilter).toBeUndefined(); // never resolved org membership
    expect(json.data.scope).toBe('self');
    expect(json.data.logs.map((l: { id: string }) => l.id)).toEqual(['log-2']);
  });

  it('an admin defaults to team scope, excluding a same-table row from a user outside the org', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'admin-1', role: 'admin', organizationId: 'org-1' });

    const res = await GET(request());
    const json = await res.json();

    expect(json.data.scope).toBe('team');
    const ids = json.data.logs.map((l: { id: string }) => l.id);
    expect(ids).toContain('log-1');
    expect(ids).toContain('log-2');
    expect(ids).not.toContain('log-3'); // outsider-1 isn't a member of org-1
  });

  it('an admin can opt back into their own activity with ?scope=self', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'admin-1', role: 'admin', organizationId: 'org-1' });

    const res = await GET(request('?scope=self'));
    const json = await res.json();

    expect(json.data.scope).toBe('self');
    expect(json.data.logs.map((l: { id: string }) => l.id)).toEqual(['log-1']);
  });

  it('resolves the actor\'s name and a readable device string for team-scope rows', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'admin-1', role: 'admin', organizationId: 'org-1' });

    const res = await GET(request());
    const json = await res.json();

    const loginRow = json.data.logs.find((l: { id: string }) => l.id === 'log-1');
    expect(loginRow.userName).toBe('Ada Admin');
    expect(loginRow.device).toBe('Pixel 7 (android)');

    const saleRow = json.data.logs.find((l: { id: string }) => l.id === 'log-2');
    expect(saleRow.userName).toBe('Sam Staff');
    expect(saleRow.device).toBeNull(); // no deviceName in details
  });

  it('a platform super_admin (no organizationId) gets self scope, not every org\'s activity', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'admin-1', role: 'super_admin', organizationId: null });

    const res = await GET(request());
    const json = await res.json();

    expect(lastUserInFilter).toBeUndefined();
    expect(json.data.scope).toBe('self');
  });
});
