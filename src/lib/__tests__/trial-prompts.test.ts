import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: {} }));
vi.mock('../supabase-client', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/email/smtp-client', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/billing.server', () => ({ recordBillingEvent: vi.fn() }));

import { activeTrialEndsAt } from '../read-only.server';
import { trialReminderStage, TRIAL_REMINDER_DAYS } from '../billing/trial-reminders.server';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-20T09:00:00Z');
const ahead = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
const trial = (trialEndsAt: string) => ({ planTier: 'free', billingStatus: 'trialing', trialEndsAt });
const org = (trialEndsAt: string) => ({ id: 'org-1', name: 'Acme', slug: 'acme', customDomain: null, customDomainStatus: null, ...trial(trialEndsAt) });

describe('activeTrialEndsAt', () => {
  it('is the trial end while the trial is running', () => {
    expect(activeTrialEndsAt(trial(ahead(9)), now)).toBe(ahead(9));
  });

  it('is null once the trial has ended, so the read-only banner takes over', () => {
    expect(activeTrialEndsAt(trial(ahead(-1)), now)).toBeNull();
  });

  it('is null for subscribed, exempt, suspended or trial-less workspaces', () => {
    expect(activeTrialEndsAt({ ...trial(ahead(5)), planTier: 'starter' }, now)).toBeNull();
    expect(activeTrialEndsAt({ ...trial(ahead(5)), planTier: 'legacy' }, now)).toBeNull();
    expect(activeTrialEndsAt({ ...trial(ahead(5)), billingStatus: 'active' }, now)).toBeNull();
    expect(activeTrialEndsAt({ ...trial(ahead(5)), billingStatus: 'suspended' }, now)).toBeNull();
    expect(activeTrialEndsAt({ planTier: 'free', billingStatus: null, trialEndsAt: null }, now)).toBeNull();
  });
});

describe('trialReminderStage', () => {
  it('sends the "ending" email only in the last days of the trial', () => {
    expect(trialReminderStage(org(ahead(TRIAL_REMINDER_DAYS + 1)), now)).toBeNull();
    expect(trialReminderStage(org(ahead(TRIAL_REMINDER_DAYS)), now)).toBe('ending');
    expect(trialReminderStage(org(ahead(0.5)), now)).toBe('ending');
  });

  it('sends the "ended" email just after the trial ends, not for long-ended trials', () => {
    expect(trialReminderStage(org(ahead(-0.5)), now)).toBe('ended');
    expect(trialReminderStage(org(ahead(-5)), now)).toBeNull();
  });

  it('never emails a workspace that has subscribed', () => {
    expect(trialReminderStage({ ...org(ahead(1)), planTier: 'starter' }, now)).toBeNull();
    expect(trialReminderStage({ ...org(ahead(-0.5)), billingStatus: 'active' }, now)).toBeNull();
  });
});
