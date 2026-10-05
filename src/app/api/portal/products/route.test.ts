import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// DELETE must never report success when the database write fails. It used to
// fall back to an in-process sample store and return 200, so a failed delete
// looked done until the next reload/deploy brought the product back.

const payload = { userId: 'user-1', role: 'admin', organizationId: 'org-1' };
vi.mock('@/lib/authorize', () => ({ requireTenantUser: vi.fn(() => payload) }));
vi.mock('@/lib/permissions.server', () => ({ hasCapability: vi.fn(async () => true) }));
vi.mock('@/lib/cost-visibility.server', () => ({ canViewCostData: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/enforce.server', () => ({ assertCanCreate: vi.fn(async () => undefined) }));
vi.mock('@/lib/storage-usage.server', () => ({ deleteUploadedFiles: vi.fn(async () => undefined) }));
const trackMock = vi.fn();
vi.mock('@/lib/activity-tracker', () => ({ trackFromRequest: (...a: unknown[]) => trackMock(...a) }));
const deleteProductMock = vi.fn(async (_id: string) => ({ softDeleted: false }));
vi.mock('@/lib/supabase-db', () => ({ deleteProduct: (id: string) => deleteProductMock(id) }));

const state = { shopStockDeleteError: null as { message: string } | null };

function chain(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'delete', 'limit']) obj[m] = vi.fn(() => obj);
  obj.maybeSingle = vi.fn(async () => resolveValue);
  (obj as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolveValue).then(res, rej);
  return obj;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'Shop') return chain({ data: { id: 'shop-1' }, error: null });
      if (table === 'Product') return chain({ data: { id: 'prod-1' }, error: null });
      if (table === 'ShopStock') return chain({ data: null, error: state.shopStockDeleteError });
      return chain({ data: null, error: null });
    }),
  },
}));

import { DELETE } from './route';

const req = (body: object) => new NextRequest('http://localhost/api/portal/products', {
  method: 'DELETE',
  headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.shopStockDeleteError = null;
  trackMock.mockClear();
  deleteProductMock.mockReset();
  deleteProductMock.mockResolvedValue({ softDeleted: false });
});

describe('DELETE /api/portal/products', () => {
  it('removes a shop stock row and logs the delete', async () => {
    const res = await DELETE(req({ productId: 'prod-1', shopId: 'shop-1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it('reports failure (not success) when the shop stock delete fails, and logs nothing', async () => {
    state.shopStockDeleteError = { message: 'db down' };
    const res = await DELETE(req({ productId: 'prod-1', shopId: 'shop-1' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/nothing was changed/);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('reports failure when a full product delete fails', async () => {
    deleteProductMock.mockRejectedValue(new Error('db down'));
    const res = await DELETE(req({ productId: 'prod-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('passes through the archive notice when the product has sales history', async () => {
    deleteProductMock.mockResolvedValue({ softDeleted: true });
    const res = await DELETE(req({ productId: 'prod-1' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ deactivated: true });
  });
});
