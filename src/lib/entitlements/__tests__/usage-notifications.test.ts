import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from './supabase-mock';

const ORG_ID = 'org-1';

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

describe('checkUsageThresholds', () => {
  beforeEach(() => {
    mockTables = { UsageThresholdNotification: [], Alert: [] };
  });

  it('creates a critical Alert when usage reaches 100%', async () => {
    const { checkUsageThresholds } = await import('../usage-notifications.server');
    await checkUsageThresholds(ORG_ID, 'PRODUCTS' as never, 10, 10);

    expect(mockTables.Alert).toHaveLength(1);
    expect(mockTables.Alert[0]).toMatchObject({ organizationId: ORG_ID, level: 'critical', title: 'Plan limit reached' });
    expect(mockTables.UsageThresholdNotification).toHaveLength(1);
    expect(mockTables.UsageThresholdNotification[0]).toMatchObject({ organizationId: ORG_ID, limitCode: 'PRODUCTS', threshold: 100 });
  });

  it('creates a warning Alert at 90% and mentions the percentage', async () => {
    const { checkUsageThresholds } = await import('../usage-notifications.server');
    await checkUsageThresholds(ORG_ID, 'STORAGE_GB' as never, 9, 10);

    expect(mockTables.Alert).toHaveLength(1);
    expect(mockTables.Alert[0]).toMatchObject({ level: 'warning' });
    expect((mockTables.Alert[0].message as string)).toContain('90%');
  });

  it('does nothing below the lowest threshold (70%)', async () => {
    const { checkUsageThresholds } = await import('../usage-notifications.server');
    await checkUsageThresholds(ORG_ID, 'USERS' as never, 6, 10);

    expect(mockTables.Alert).toHaveLength(0);
    expect(mockTables.UsageThresholdNotification).toHaveLength(0);
  });

  it('does nothing for an unlimited (null) limit', async () => {
    const { checkUsageThresholds } = await import('../usage-notifications.server');
    await checkUsageThresholds(ORG_ID, 'PRODUCTS' as never, 999999, null);

    expect(mockTables.Alert).toHaveLength(0);
  });

  it('only fires the single highest threshold when usage jumps past several at once', async () => {
    const { checkUsageThresholds } = await import('../usage-notifications.server');
    await checkUsageThresholds(ORG_ID, 'PRODUCTS' as never, 96, 100); // crosses 70/80/90/95 in one step

    expect(mockTables.Alert).toHaveLength(1);
    expect(mockTables.UsageThresholdNotification).toHaveLength(1);
    expect(mockTables.UsageThresholdNotification[0]).toMatchObject({ threshold: 95 });
  });
});
