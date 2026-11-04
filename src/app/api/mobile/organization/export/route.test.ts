import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let caller: Record<string, unknown>;
let ownerLevel = true;
let zipBytes = 10;
const build = vi.fn();
const track = vi.fn();

vi.mock('@/lib/authorize', () => ({ requireTenantUser: () => caller }));
vi.mock('@/lib/deactivated-staff.server', () => ({ rejectIfDeactivated: async () => null }));
vi.mock('@/lib/permissions.server', () => ({ isOwnerLevelCaller: async () => ownerLevel }));
vi.mock('@/lib/activity-tracker', () => ({ trackFromRequest: (...a: unknown[]) => track(...a) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/data-export.server', () => ({
  MAX_EXPORT_BYTES: 100,
  buildOrgExport: (...a: unknown[]) => build(...a),
}));

import { GET } from './route';

const get = () => GET(new NextRequest('http://localhost/api/mobile/organization/export'));

describe('GET /api/mobile/organization/export', () => {
  beforeEach(() => {
    caller = { userId: 'u1', role: 'admin', organizationId: 'org-1' };
    ownerLevel = true;
    zipBytes = 10;
    build.mockReset();
    track.mockReset();
    build.mockImplementation(async () => ({ zip: Buffer.alloc(zipBytes), fileName: 'royaltrack-acme.zip', counts: [] }));
  });

  it('refuses staff who are not owner level', async () => {
    ownerLevel = false;
    expect((await get()).status).toBe(403);
    expect(build).not.toHaveBeenCalled();
  });

  it('refuses a caller with no workspace', async () => {
    caller = { userId: 'u1', role: 'super_admin', organizationId: null };
    expect((await get()).status).toBe(403);
    expect(build).not.toHaveBeenCalled();
  });

  it('exports only the caller\'s own workspace and records it', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(build).toHaveBeenCalledWith('org-1');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('royaltrack-acme.zip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(track.mock.calls[0][2].action).toBe('data.export');
  });

  it('explains when the export is too large', async () => {
    zipBytes = 101;
    const res = await get();
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('EXPORT_TOO_LARGE');
  });

  it('reports a failure without leaking details', async () => {
    build.mockRejectedValue(new Error('SalesEntry: secret detail'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});
