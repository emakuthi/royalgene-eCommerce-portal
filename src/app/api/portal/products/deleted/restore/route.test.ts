import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let payload: { userId: string; role: string; organizationId: string | null };
vi.mock('@/lib/authorize', () => ({ requireTenantUser: vi.fn(() => payload) }));

const trackMock = vi.fn(async (..._a: unknown[]) => null);
vi.mock('@/lib/activity-tracker', () => ({ trackFromRequest: (...a: unknown[]) => trackMock(...a) }));

const restoreMock = vi.fn();
vi.mock('@/lib/product-restore.server', () => ({ restoreDeletedProduct: (...a: unknown[]) => restoreMock(...a) }));

import { POST } from './route';

const req = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/portal/products/deleted/restore', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /api/portal/products/deleted/restore', () => {
  beforeEach(() => {
    payload = { userId: 'admin-1', role: 'admin', organizationId: 'org-1' };
    trackMock.mockClear();
    restoreMock.mockReset();
  });

  it('refuses staff', async () => {
    payload = { userId: 'staff-1', role: 'portal_user', organizationId: 'org-1' };
    expect((await POST(req({ id: 'p1' }))).status).toBe(403);
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it('requires an id', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it('restores in the caller’s own workspace and logs it', async () => {
    restoreMock.mockResolvedValue({ ok: true, restored: ['s1'], skipped: [] });
    const res = await POST(req({ id: 'p1' }));

    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith('org-1', 'p1');
    expect(trackMock).toHaveBeenCalledWith(expect.anything(), payload, expect.objectContaining({ action: 'product.restore', resourceId: 'p1' }));
  });

  it('says which shops could not take it back', async () => {
    restoreMock.mockResolvedValue({ ok: true, restored: ['s1'], skipped: [{ shopId: 's2', reason: 'SKU_TAKEN' }] });
    const json = await (await POST(req({ id: 'p1' }))).json();

    expect(json.data.skipped).toEqual([{ shopId: 's2', reason: 'SKU_TAKEN' }]);
    expect(json.message).toMatch(/couldn’t take it back/);
  });

  it('explains when nothing was saved, and logs nothing', async () => {
    restoreMock.mockResolvedValue({ ok: false, code: 'NOTHING_TO_RESTORE', skipped: [] });
    const res = await POST(req({ id: 'p1' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Add it again/);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a product outside the workspace', async () => {
    restoreMock.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect((await POST(req({ id: 'p1' }))).status).toBe(404);
  });
});
