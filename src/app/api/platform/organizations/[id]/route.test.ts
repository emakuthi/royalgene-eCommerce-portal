import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/authorize', () => ({
  requireRole: vi.fn(() => ({ userId: 'admin-1', role: 'super_admin', organizationId: null })),
}));

const softDeleteOrganization = vi.fn();
const purgeOrganization = vi.fn();
const updateOrganizationDetails = vi.fn();
const updateOrganizationStatus = vi.fn();
const updateOrganizationPlan = vi.fn();

vi.mock('@/lib/organizations.server', () => ({
  softDeleteOrganization: (...a: unknown[]) => softDeleteOrganization(...a),
  purgeOrganization: (...a: unknown[]) => purgeOrganization(...a),
  updateOrganizationDetails: (...a: unknown[]) => updateOrganizationDetails(...a),
  updateOrganizationStatus: (...a: unknown[]) => updateOrganizationStatus(...a),
  updateOrganizationPlan: (...a: unknown[]) => updateOrganizationPlan(...a),
}));

import { DELETE, PATCH } from './route';

const params = Promise.resolve({ id: 'org-2' });
const req = (url: string, opts: { method: string; body?: string } = { method: 'GET' }) =>
  new NextRequest(`http://localhost${url}`, {
    method: opts.method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: opts.body,
  });

beforeEach(() => { vi.clearAllMocks(); });

describe('DELETE /api/platform/organizations/[id]', () => {
  it('soft-deletes by default', async () => {
    softDeleteOrganization.mockResolvedValueOnce({ id: 'org-2', status: 'cancelled' });
    const res = await DELETE(req('/api/platform/organizations/org-2', { method: 'DELETE' }), { params });
    expect(res.status).toBe(200);
    expect(softDeleteOrganization).toHaveBeenCalledWith('org-2');
    expect(purgeOrganization).not.toHaveBeenCalled();
  });

  it('404s when the org is gone', async () => {
    softDeleteOrganization.mockResolvedValueOnce(null);
    const res = await DELETE(req('/api/platform/organizations/org-2', { method: 'DELETE' }), { params });
    expect(res.status).toBe(404);
  });

  it('purges with ?purge=true and passes the confirm slug through', async () => {
    purgeOrganization.mockResolvedValueOnce({ ok: true });
    const res = await DELETE(
      req('/api/platform/organizations/org-2?purge=true', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'acme' }),
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(purgeOrganization).toHaveBeenCalledWith('org-2', 'acme');
    expect(softDeleteOrganization).not.toHaveBeenCalled();
  });

  it('400s when purge is rejected (e.g. not soft-deleted first)', async () => {
    purgeOrganization.mockResolvedValueOnce({ ok: false, error: 'Soft-delete the tenant before purging it' });
    const res = await DELETE(
      req('/api/platform/organizations/org-2?purge=true', { method: 'DELETE', body: JSON.stringify({ confirm: 'acme' }) }),
      { params },
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/platform/organizations/[id]', () => {
  it('updates the display name', async () => {
    updateOrganizationDetails.mockResolvedValueOnce({ id: 'org-2', name: 'Renamed' });
    const res = await PATCH(
      req('/api/platform/organizations/org-2', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(updateOrganizationDetails).toHaveBeenCalledWith('org-2', { name: 'Renamed' });
  });

  it('400s with no recognised field', async () => {
    const res = await PATCH(
      req('/api/platform/organizations/org-2', { method: 'PATCH', body: JSON.stringify({}) }),
      { params },
    );
    expect(res.status).toBe(400);
  });
});
