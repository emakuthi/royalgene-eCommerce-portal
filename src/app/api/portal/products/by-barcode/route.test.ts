import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Barcode scanning is a plan feature (Business and up). The lookup must refuse
// tenants whose plan doesn't include it before touching any product data.

const payload = { userId: 'user-1', role: 'shop_manager', organizationId: 'org-1' };
vi.mock('@/lib/authorize', () => ({ requireTenantUser: vi.fn(() => payload) }));

const gate = { enabled: true };
vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertFeatureEnabled: vi.fn(async () =>
    gate.enabled
      ? null
      : NextResponse.json({ success: false, code: 'FEATURE_NOT_AVAILABLE', feature: 'BARCODE' }, { status: 403 }),
  ),
}));

const resolveBarcode = vi.fn(async () => ({ found: false, code: '123' }));
vi.mock('@/lib/barcode.server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/barcode.server')>('@/lib/barcode.server');
  return { ...actual, resolveBarcode: (...args: unknown[]) => resolveBarcode(...(args as [])) };
});

function chain(value: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) obj[m] = vi.fn(() => obj);
  obj.maybeSingle = vi.fn(async () => ({ data: value, error: null }));
  return obj;
}
vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: vi.fn(() => chain({ id: 'shop-1' })) },
}));

import { GET } from './route';

const get = () =>
  GET(new NextRequest('http://localhost/api/portal/products/by-barcode?code=123&shopId=shop-1', {
    headers: { authorization: 'Bearer t' },
  }));

beforeEach(() => {
  gate.enabled = true;
  resolveBarcode.mockClear();
});

describe('GET /api/portal/products/by-barcode', () => {
  it('resolves the code when the plan includes barcode scanning', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(resolveBarcode).toHaveBeenCalledOnce();
  });

  it('returns 403 FEATURE_NOT_AVAILABLE and does no lookup when the plan lacks it', async () => {
    gate.enabled = false;
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FEATURE_NOT_AVAILABLE');
    expect(resolveBarcode).not.toHaveBeenCalled();
  });
});
