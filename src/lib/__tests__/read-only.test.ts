import { describe, it, expect } from 'vitest';
import { readOnlyReason, PAID_GRACE_DAYS } from '../tenant';
import { addBillingPeriod } from '../billing.server';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-17T12:00:00Z');
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const ahead = (days: number) => new Date(now + days * DAY).toISOString();
const org = (o: Partial<Parameters<typeof readOnlyReason>[0]>) =>
  ({ planTier: 'free', trialEndsAt: null, billingStatus: null, paidThrough: null, ...o }) as Parameters<typeof readOnlyReason>[0];

describe('readOnlyReason', () => {
  it('a running trial has full use; an ended one is read-only', () => {
    expect(readOnlyReason(org({ trialEndsAt: ahead(3) }), now)).toBeNull();
    expect(readOnlyReason(org({ trialEndsAt: ago(1) }), now)).toBe('trial_ended');
  });

  it('exempt (legacy) workspaces are never read-only', () => {
    expect(readOnlyReason(org({ planTier: 'legacy', trialEndsAt: ago(30), billingStatus: 'suspended' }), now)).toBeNull();
  });

  it('a paid plan lapses only after the grace days', () => {
    expect(readOnlyReason(org({ planTier: 'starter', paidThrough: ago(PAID_GRACE_DAYS - 1) }), now)).toBeNull();
    expect(readOnlyReason(org({ planTier: 'starter', paidThrough: ago(PAID_GRACE_DAYS + 1) }), now)).toBe('plan_lapsed');
  });

  it('a plan with no paid period (assigned by hand) never lapses', () => {
    expect(readOnlyReason(org({ planTier: 'enterprise', billingStatus: 'active' }), now)).toBeNull();
  });

  it('suspended billing is read-only', () => {
    expect(readOnlyReason(org({ planTier: 'pro', billingStatus: 'suspended', paidThrough: ahead(20) }), now)).toBe('billing_suspended');
  });
});

describe('addBillingPeriod', () => {
  const at = new Date('2026-10-17T12:00:00Z');
  it('counts from now when nothing is paid ahead', () => {
    expect(addBillingPeriod(null, 'monthly', at)).toBe('2026-11-17T12:00:00.000Z');
    expect(addBillingPeriod('2026-09-01T00:00:00Z', 'annually', at)).toBe('2027-10-17T12:00:00.000Z');
  });

  it('paying early adds to the end of the current period', () => {
    expect(addBillingPeriod('2026-10-30T00:00:00.000Z', 'monthly', at)).toBe('2026-11-30T00:00:00.000Z');
  });
});
