import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createSupabaseMock, type MockTables } from '../../entitlements/__tests__/supabase-mock';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

let mockTables: MockTables;

vi.mock('../../supabase-client', () => ({
  get supabaseAdmin() {
    return createSupabaseMock(mockTables);
  },
}));

describe('quickbooks-connection', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    mockTables = { TenantOAuthConnection: [] };
  });

  it('save -> status reflects connected with the realmId, not the tokens', async () => {
    const { saveQuickBooksConnection, getQuickBooksConnectionSummary } = await import('../quickbooks-connection.server');
    await saveQuickBooksConnection(ORG_A, { realmId: 'realm-123', accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 3600 });

    const summary = await getQuickBooksConnectionSummary(ORG_A);
    expect(summary.connected).toBe(true);
    expect(summary.realmId).toBe('realm-123');
    expect(JSON.stringify(summary)).not.toContain('at');
  });

  it('getValidAccessToken decrypts and returns the stored token when not near expiry', async () => {
    const { saveQuickBooksConnection, getValidAccessToken } = await import('../quickbooks-connection.server');
    await saveQuickBooksConnection(ORG_A, { realmId: 'realm-123', accessToken: 'live-token', refreshToken: 'rt', expiresInSeconds: 3600 });

    const result = await getValidAccessToken(ORG_A);
    expect(result).toEqual({ realmId: 'realm-123', accessToken: 'live-token' });
  });

  it('tenant isolation: org B has no connection after org A connects', async () => {
    const { saveQuickBooksConnection, getQuickBooksConnectionSummary } = await import('../quickbooks-connection.server');
    await saveQuickBooksConnection(ORG_A, { realmId: 'realm-123', accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 3600 });

    const orgBSummary = await getQuickBooksConnectionSummary(ORG_B);
    expect(orgBSummary.connected).toBe(false);
  });

  it('disconnect removes the connection', async () => {
    const { saveQuickBooksConnection, disconnectQuickBooks, getQuickBooksConnectionSummary } = await import('../quickbooks-connection.server');
    await saveQuickBooksConnection(ORG_A, { realmId: 'realm-123', accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 3600 });
    await disconnectQuickBooks(ORG_A);

    const summary = await getQuickBooksConnectionSummary(ORG_A);
    expect(summary.connected).toBe(false);
  });
});
