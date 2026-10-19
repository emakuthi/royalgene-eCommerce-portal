import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: {} }));
vi.mock('../supabase-client', () => ({ supabaseAdmin: {} }));

import { manualRenewalDueAt, RENEWAL_REMINDER_DAYS } from '../read-only.server';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-14T09:00:00Z');
const ahead = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
const mpesaPaid = (paidThrough: string) => ({ planTier: 'business', billingStatus: 'active', paidThrough, paystackPlanCode: null });

describe('manualRenewalDueAt', () => {
  it('reminds an M-Pesa payer in the last days of the period', () => {
    expect(manualRenewalDueAt(mpesaPaid(ahead(3)), now)).toBe(ahead(3));
    expect(manualRenewalDueAt(mpesaPaid(ahead(RENEWAL_REMINDER_DAYS + 1)), now)).toBeNull();
  });

  it('never reminds a card subscription that renews by itself', () => {
    expect(manualRenewalDueAt({ ...mpesaPaid(ahead(1)), paystackPlanCode: 'PLN_m' }, now)).toBeNull();
  });

  it('skips exempt, hand-assigned, inactive and already-lapsed workspaces', () => {
    expect(manualRenewalDueAt({ ...mpesaPaid(ahead(1)), planTier: 'legacy' }, now)).toBeNull();
    expect(manualRenewalDueAt({ ...mpesaPaid(ahead(1)), paidThrough: null }, now)).toBeNull();
    expect(manualRenewalDueAt({ ...mpesaPaid(ahead(1)), billingStatus: 'suspended' }, now)).toBeNull();
    expect(manualRenewalDueAt(mpesaPaid(ahead(-1)), now)).toBeNull();
  });
});
