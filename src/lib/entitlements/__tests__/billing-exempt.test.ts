import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from './supabase-mock';

// The platform "Exempt from billing" switch: exempt is the legacy plan tier,
// and extending a trial must not quietly take the exemption away.

vi.mock('server-only', () => ({}));
vi.mock('../../billing.server', () => ({ recordBillingEvent: vi.fn(async () => undefined) }));

let tables: MockTables;
vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(tables);
  },
}));

const tierOf = (id: string) => tables.Organization.find((o) => o.id === id)?.planTier;

beforeEach(() => {
  tables = {
    Organization: [
      { id: 'org-trial', planTier: 'free', trialEndsAt: '2020-01-01T00:00:00.000Z' },
      { id: 'org-paid', planTier: 'starter' },
      { id: 'org-exempt', planTier: 'legacy' },
    ],
    TenantSubscription: [
      { id: 's1', organizationId: 'org-trial', planId: 'plan-pro', status: 'trialing', trialEnd: '2020-01-01T00:00:00.000Z' },
      { id: 's2', organizationId: 'org-paid', planId: 'plan-starter', status: 'active', trialEnd: null },
      { id: 's3', organizationId: 'org-exempt', planId: 'plan-pro', status: 'trialing', trialEnd: '2020-01-01T00:00:00.000Z' },
    ],
    PlatformPlan: [
      { id: 'plan-starter', tier: 'starter' },
      { id: 'plan-pro', tier: 'pro' },
    ],
  };
});

describe('setBillingExempt', () => {
  it('exempts a workspace by moving it to the legacy tier', async () => {
    const { setBillingExempt } = await import('../subscription-status.server');
    expect(await setBillingExempt('org-trial', true)).toEqual({ planTier: 'legacy' });
    expect(tierOf('org-trial')).toBe('legacy');
  });

  it('ending an exemption returns an active subscriber to its paid plan', async () => {
    const { setBillingExempt } = await import('../subscription-status.server');
    await setBillingExempt('org-paid', true);
    expect(await setBillingExempt('org-paid', false)).toEqual({ planTier: 'starter' });
    expect(tierOf('org-paid')).toBe('starter');
  });

  it('ending an exemption without an active paid plan returns the workspace to free', async () => {
    const { setBillingExempt } = await import('../subscription-status.server');
    expect(await setBillingExempt('org-exempt', false)).toEqual({ planTier: 'free' });
    expect(tierOf('org-exempt')).toBe('free');
  });
});

describe('extendTrial', () => {
  it('keeps an exempt workspace exempt', async () => {
    const { extendTrial } = await import('../subscription-status.server');
    await extendTrial('org-exempt', 14);
    expect(tierOf('org-exempt')).toBe('legacy');
  });

  it('still puts a normal workspace back on the free trial', async () => {
    const { extendTrial } = await import('../subscription-status.server');
    await extendTrial('org-paid', 14);
    expect(tierOf('org-paid')).toBe('free');
  });
});
