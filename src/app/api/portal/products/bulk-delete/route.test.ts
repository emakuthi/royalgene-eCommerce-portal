import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ProductDeleteOutcome } from '@/lib/product-delete.server';

let payload: { userId: string; role: string; organizationId: string | null };
vi.mock('@/lib/authorize', () => ({
  requireTenantUser: vi.fn(() => payload),
}));

const hasCapabilityMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/lib/permissions.server', () => ({
  hasCapability: (...args: unknown[]) => hasCapabilityMock(...args),
}));

vi.mock('@/lib/activity-tracker', () => ({
  trackFromRequest: vi.fn(async () => null),
}));

const deleteProductsInOrgMock = vi.fn(async (..._args: unknown[]): Promise<ProductDeleteOutcome> => ({ deleted: [], archived: [], notFound: [], failed: [] }));
vi.mock('@/lib/product-delete.server', () => ({
  deleteProductsInOrg: (...args: unknown[]) => deleteProductsInOrgMock(...args),
}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/portal/products/bulk-delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/portal/products/bulk-delete', () => {
  beforeEach(() => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    hasCapabilityMock.mockReset().mockResolvedValue(true);
    deleteProductsInOrgMock.mockReset();
  });

  it('rejects a non-admin even if they somehow have the capability flag', async () => {
    payload = { userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' };
    const res = await POST(request({ productIds: ['p1'] }));
    expect(res.status).toBe(403);
    expect(deleteProductsInOrgMock).not.toHaveBeenCalled();
  });

  it('rejects an admin without the delete_inventory capability', async () => {
    hasCapabilityMock.mockResolvedValue(false);
    const res = await POST(request({ productIds: ['p1'] }));
    expect(res.status).toBe(403);
    expect(deleteProductsInOrgMock).not.toHaveBeenCalled();
  });

  it('rejects an empty productIds array', async () => {
    const res = await POST(request({ productIds: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects more than 50 ids in one call', async () => {
    const res = await POST(request({ productIds: Array.from({ length: 51 }, (_, i) => `p${i}`) }));
    expect(res.status).toBe(400);
  });

  it('deletes for an authorized admin, scoped to their own org', async () => {
    deleteProductsInOrgMock.mockResolvedValue({ deleted: ['p1', 'p2'], archived: [], notFound: [], failed: [] });
    const res = await POST(request({ productIds: ['p1', 'p2'] }));
    const json = await res.json();

    expect(deleteProductsInOrgMock).toHaveBeenCalledWith('org-1', ['p1', 'p2']);
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.deleted).toEqual(['p1', 'p2']);
  });

  it('reports an archive instead of erase in the message when a product has sales history', async () => {
    deleteProductsInOrgMock.mockResolvedValue({ deleted: ['p1'], archived: ['p2'], notFound: [], failed: [] });
    const res = await POST(request({ productIds: ['p1', 'p2'] }));
    const json = await res.json();

    expect(json.message).toMatch(/archived instead of erased/);
  });

  it('reports failure (500) when nothing at all could be removed', async () => {
    deleteProductsInOrgMock.mockResolvedValue({ deleted: [], archived: [], notFound: [], failed: [{ id: 'p1', error: 'db error' }] });
    const res = await POST(request({ productIds: ['p1'] }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
