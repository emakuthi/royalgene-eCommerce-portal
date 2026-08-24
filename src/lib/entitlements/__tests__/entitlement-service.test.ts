import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from './supabase-mock';

const ORG_STARTER = 'org-starter';
const ORG_LEGACY = 'org-legacy';
const ORG_TRIAL_LAPSED = 'org-trial-lapsed';
const ORG_ENTERPRISE = 'org-enterprise';
const PLAN_STARTER = 'plan-starter';
const PLAN_PRO = 'plan-pro';
const PLAN_ENTERPRISE = 'plan-enterprise';

function baseTables(): MockTables {
  return {
    Organization: [
      { id: ORG_STARTER, planTier: 'starter' },
      { id: ORG_LEGACY, planTier: 'legacy' },
      { id: ORG_TRIAL_LAPSED, planTier: 'free' },
      { id: ORG_ENTERPRISE, planTier: 'enterprise' },
    ],
    TenantSubscription: [
      { organizationId: ORG_STARTER, planId: PLAN_STARTER, status: 'active', trialEnd: null },
      { organizationId: ORG_TRIAL_LAPSED, planId: PLAN_PRO, status: 'trialing', trialEnd: '2020-01-01T00:00:00.000Z' },
      { organizationId: ORG_ENTERPRISE, planId: PLAN_ENTERPRISE, status: 'active', trialEnd: null },
    ],
    PlatformPlan: [
      { id: PLAN_STARTER, tier: 'starter', code: 'STARTER' },
      { id: PLAN_PRO, tier: 'pro', code: 'PROFESSIONAL' },
      { id: PLAN_ENTERPRISE, tier: 'enterprise', code: 'ENTERPRISE' },
    ],
    PlanEntitlement: [
      { planId: PLAN_STARTER, code: 'SALES', enabled: true, limitValue: null },
      { planId: PLAN_STARTER, code: 'BARCODE', enabled: false, limitValue: null },
      { planId: PLAN_STARTER, code: 'PRODUCTS', enabled: true, limitValue: 2 },
      { planId: PLAN_STARTER, code: 'USERS', enabled: true, limitValue: 3 },
      { planId: PLAN_PRO, code: 'SALES', enabled: true, limitValue: null },
      { planId: PLAN_PRO, code: 'BARCODE', enabled: true, limitValue: null },
      { planId: PLAN_PRO, code: 'PRODUCTS', enabled: true, limitValue: 50000 },
      { planId: PLAN_ENTERPRISE, code: 'PRODUCTS', enabled: true, limitValue: null },
      { planId: PLAN_STARTER, code: 'STORAGE_GB', enabled: true, limitValue: 2 },
      { planId: PLAN_ENTERPRISE, code: 'STORAGE_GB', enabled: true, limitValue: null },
    ],
    Product: [
      { id: 'p1', organizationId: ORG_STARTER },
      { id: 'p2', organizationId: ORG_STARTER },
    ],
    PortalUser: [],
    Shop: [],
    SalesEntry: [],
    TenantFileUpload: [],
  };
}

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

describe('entitlement-service', () => {
  beforeEach(() => {
    mockTables = baseTables();
  });

  it('hasFeature reflects the plan entitlement row', async () => {
    const { hasFeature } = await import('../entitlement-service.server');
    expect(await hasFeature(ORG_STARTER, 'SALES' as never)).toBe(true);
    expect(await hasFeature(ORG_STARTER, 'BARCODE' as never)).toBe(false);
  });

  it('legacy tier bypasses every check', async () => {
    const { hasFeature, getLimit } = await import('../entitlement-service.server');
    expect(await hasFeature(ORG_LEGACY, 'BARCODE' as never)).toBe(true);
    expect(await getLimit(ORG_LEGACY, 'PRODUCTS' as never)).toBeNull();
  });

  it('enterprise plan resolves unlimited (null) limits', async () => {
    const { getLimit } = await import('../entitlement-service.server');
    expect(await getLimit(ORG_ENTERPRISE, 'PRODUCTS' as never)).toBeNull();
  });

  it('a lapsed trial is treated as restricted even before the DB row is reconciled', async () => {
    const { hasFeature, getLimit } = await import('../entitlement-service.server');
    // TenantSubscription.status is still 'trialing' in the fixture — only trialEnd is in the past.
    expect(await hasFeature(ORG_TRIAL_LAPSED, 'SALES' as never)).toBe(false);
    expect(await getLimit(ORG_TRIAL_LAPSED, 'PRODUCTS' as never)).toBe(0);
  });

  it('canCreate blocks at the limit and allows below it', async () => {
    const { canCreate } = await import('../entitlement-service.server');
    // Starter plan: PRODUCTS limit = 2, fixture already has 2 Product rows for ORG_STARTER.
    const result = await canCreate(ORG_STARTER, 'PRODUCT');
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(2);
    expect(result.currentUsage).toBe(2);
    expect(result.remaining).toBe(0);
  });

  it('canCreate allows creation under the limit', async () => {
    const { canCreate } = await import('../entitlement-service.server');
    const result = await canCreate(ORG_STARTER, 'USER');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
    expect(result.currentUsage).toBe(0);
  });

  it('tenant isolation: usage/limit checks for one org never count another org\'s rows', async () => {
    const ORG_B = 'org-b';
    mockTables.Organization.push({ id: ORG_B, planTier: 'starter' });
    mockTables.TenantSubscription.push({ organizationId: ORG_B, planId: PLAN_STARTER, status: 'active', trialEnd: null });
    // ORG_STARTER already has 2 Product rows (fixture) at its limit of 2 — ORG_B has none of its own.
    const { canCreate, getUsage } = await import('../entitlement-service.server');

    const orgBUsage = await getUsage(ORG_B, 'PRODUCT');
    expect(orgBUsage).toBe(0);

    const orgBResult = await canCreate(ORG_B, 'PRODUCT');
    expect(orgBResult.allowed).toBe(true);
    expect(orgBResult.currentUsage).toBe(0);

    // ORG_STARTER's own usage is unaffected by ORG_B existing.
    const orgAResult = await canCreate(ORG_STARTER, 'PRODUCT');
    expect(orgAResult.allowed).toBe(false);
    expect(orgAResult.currentUsage).toBe(2);
  });

  it('getStorageUsageGB sums undeleted TenantFileUpload rows, ignoring other orgs and soft-deleted rows', async () => {
    mockTables.TenantFileUpload = [
      { organizationId: ORG_STARTER, sizeBytes: 512 * 1024 * 1024, deletedAt: null }, // 0.5 GB
      { organizationId: ORG_STARTER, sizeBytes: 512 * 1024 * 1024, deletedAt: null }, // 0.5 GB
      { organizationId: ORG_STARTER, sizeBytes: 1024 * 1024 * 1024, deletedAt: '2026-01-01T00:00:00.000Z' }, // soft-deleted, excluded
      { organizationId: ORG_ENTERPRISE, sizeBytes: 5 * 1024 * 1024 * 1024, deletedAt: null }, // other org, excluded
    ];
    const { getStorageUsageGB } = await import('../../storage-usage.server');
    expect(await getStorageUsageGB(ORG_STARTER)).toBe(1);
  });

  it('getTenantEntitlementSummary includes STORAGE_GB with the plan limit and live usage', async () => {
    mockTables.TenantFileUpload = [
      { organizationId: ORG_STARTER, sizeBytes: 1024 * 1024 * 1024, deletedAt: null }, // 1 GB
    ];
    const { getTenantEntitlementSummary } = await import('../entitlement-service.server');
    const summary = await getTenantEntitlementSummary(ORG_STARTER);
    expect(summary.limits.STORAGE_GB).toMatchObject({ limit: 2, usage: 1, remaining: 1 });
  });
});
