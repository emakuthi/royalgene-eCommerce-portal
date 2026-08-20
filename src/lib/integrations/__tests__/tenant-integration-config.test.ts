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

describe('tenant-integration-config (M-Pesa)', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    mockTables = { TenantIntegrationConfig: [] };
  });

  it('set -> get round-trips the full config, decrypted', async () => {
    const { setMpesaConfig, getMpesaConfig } = await import('../tenant-integration-config.server');
    await setMpesaConfig(ORG_A, {
      consumerKey: 'ck-a',
      consumerSecret: 'cs-a',
      passkey: 'pk-a',
      businessShortCode: '174379',
      environment: 'sandbox',
      callbackUrl: 'https://a.example.com/api/mpesa/callback',
    });

    const resolved = await getMpesaConfig(ORG_A);
    expect(resolved).toEqual({
      consumerKey: 'ck-a',
      consumerSecret: 'cs-a',
      passkey: 'pk-a',
      businessShortCode: '174379',
      environment: 'sandbox',
      callbackUrl: 'https://a.example.com/api/mpesa/callback',
    });
  });

  it('summary never includes decrypted secret fields', async () => {
    const { setMpesaConfig, getMpesaConfigSummary } = await import('../tenant-integration-config.server');
    await setMpesaConfig(ORG_A, {
      consumerKey: 'ck-a', consumerSecret: 'cs-a', passkey: 'pk-a',
      businessShortCode: '174379', environment: 'sandbox', callbackUrl: 'https://a.example.com/cb',
    });

    const summary = await getMpesaConfigSummary(ORG_A);
    expect(summary).toMatchObject({ businessShortCode: '174379', environment: 'sandbox', isActive: true });
    expect(JSON.stringify(summary)).not.toContain('cs-a');
    expect(JSON.stringify(summary)).not.toContain('pk-a');
    expect(summary).not.toHaveProperty('consumerKey');
    expect(summary).not.toHaveProperty('consumerSecret');
    expect(summary).not.toHaveProperty('passkey');
  });

  it('tenant isolation: org B never resolves org A\'s credentials', async () => {
    const { setMpesaConfig, getMpesaConfig } = await import('../tenant-integration-config.server');
    await setMpesaConfig(ORG_A, {
      consumerKey: 'ck-a', consumerSecret: 'cs-a', passkey: 'pk-a',
      businessShortCode: '111111', environment: 'sandbox', callbackUrl: 'https://a.example.com/cb',
    });

    const orgBConfig = await getMpesaConfig(ORG_B);
    expect(orgBConfig).toBeNull();
  });

  it('remove clears the config', async () => {
    const { setMpesaConfig, removeMpesaConfig, getMpesaConfig } = await import('../tenant-integration-config.server');
    await setMpesaConfig(ORG_A, {
      consumerKey: 'ck-a', consumerSecret: 'cs-a', passkey: 'pk-a',
      businessShortCode: '111111', environment: 'sandbox', callbackUrl: 'https://a.example.com/cb',
    });
    await removeMpesaConfig(ORG_A);
    expect(await getMpesaConfig(ORG_A)).toBeNull();
  });
});
