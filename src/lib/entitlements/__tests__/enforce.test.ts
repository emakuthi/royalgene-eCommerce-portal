import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from './supabase-mock';

const ORG_ID = 'org-1';
const PLAN_ID = 'plan-1';

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

describe('enforce.server', () => {
  beforeEach(() => {
    mockTables = {
      Organization: [{ id: ORG_ID, planTier: 'starter' }],
      TenantSubscription: [{ organizationId: ORG_ID, planId: PLAN_ID, status: 'active', trialEnd: null }],
      PlatformPlan: [{ id: PLAN_ID, tier: 'starter', code: 'STARTER' }],
      PlanEntitlement: [
        { planId: PLAN_ID, code: 'PRODUCTS', enabled: true, limitValue: 1 },
        { planId: PLAN_ID, code: 'BARCODE', enabled: false, limitValue: null },
        { planId: PLAN_ID, code: 'STORAGE_GB', enabled: true, limitValue: 1 },
      ],
      Product: [{ id: 'p1', organizationId: ORG_ID }],
      TenantFileUpload: [],
    };
  });

  it('assertCanCreate returns the PLAN_LIMIT_REACHED shape when the limit is hit', async () => {
    const { assertCanCreate } = await import('../enforce.server');
    const res = await assertCanCreate(ORG_ID, 'PRODUCT');
    expect(res).not.toBeNull();
    const json = await res!.json();
    expect(res!.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      code: 'PLAN_LIMIT_REACHED',
      feature: 'PRODUCTS',
      limit: 1,
      currentUsage: 1,
      upgradeRequired: true,
    });
  });

  it('assertCanCreate returns null when under the limit', async () => {
    mockTables.Product = [];
    const { assertCanCreate } = await import('../enforce.server');
    const res = await assertCanCreate(ORG_ID, 'PRODUCT');
    expect(res).toBeNull();
  });

  it('assertStorageQuota blocks an upload that would push usage past the plan limit', async () => {
    // Plan limit is 1 GB; fixture already has 0.9 GB used, uploading another 0.2 GB would exceed it.
    mockTables.TenantFileUpload = [{ organizationId: ORG_ID, sizeBytes: Math.round(0.9 * 1024 ** 3), deletedAt: null }];
    const { assertStorageQuota } = await import('../enforce.server');
    const res = await assertStorageQuota(ORG_ID, Math.round(0.2 * 1024 ** 3));
    expect(res).not.toBeNull();
    const json = await res!.json();
    expect(res!.status).toBe(403);
    expect(json).toMatchObject({ success: false, code: 'PLAN_LIMIT_REACHED', feature: 'STORAGE_GB', limit: 1, upgradeRequired: true });
  });

  it('assertStorageQuota allows an upload that stays within the plan limit', async () => {
    mockTables.TenantFileUpload = [{ organizationId: ORG_ID, sizeBytes: Math.round(0.1 * 1024 ** 3), deletedAt: null }];
    const { assertStorageQuota } = await import('../enforce.server');
    const res = await assertStorageQuota(ORG_ID, Math.round(0.2 * 1024 ** 3));
    expect(res).toBeNull();
  });

  it('assertFeatureEnabled returns the FEATURE_NOT_AVAILABLE shape for a disabled feature', async () => {
    const { assertFeatureEnabled } = await import('../enforce.server');
    const res = await assertFeatureEnabled(ORG_ID, 'BARCODE' as never);
    expect(res).not.toBeNull();
    const json = await res!.json();
    expect(res!.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      code: 'FEATURE_NOT_AVAILABLE',
      feature: 'BARCODE',
      currentPlan: 'STARTER',
      upgradeRequired: true,
    });
  });
});
