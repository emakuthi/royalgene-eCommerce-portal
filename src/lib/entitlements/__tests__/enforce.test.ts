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
      ],
      Product: [{ id: 'p1', organizationId: ORG_ID }],
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
