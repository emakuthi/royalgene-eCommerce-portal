import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

let currentRole: 'admin' | 'portal_user' = 'admin';

vi.mock('@/lib/authorize', () => ({
  requireAuth: vi.fn(() => ({ userId: 'user-1', role: currentRole, organizationId: 'org-1' })),
  requireRole: vi.fn((_req: unknown, allowed: string[]) => {
    if (!allowed.includes(currentRole)) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }
    return { userId: 'user-1', role: currentRole, organizationId: 'org-1' };
  }),
}));

const assertFeatureEnabledMock = vi.fn();
vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertFeatureEnabled: (...args: unknown[]) => assertFeatureEnabledMock(...args),
}));

const setMpesaConfigMock = vi.fn();
const getMpesaConfigSummaryMock = vi.fn();
const removeMpesaConfigMock = vi.fn();
vi.mock('@/lib/integrations/tenant-integration-config.server', () => ({
  setMpesaConfig: (...args: unknown[]) => setMpesaConfigMock(...args),
  getMpesaConfigSummary: (...args: unknown[]) => getMpesaConfigSummaryMock(...args),
  removeMpesaConfig: (...args: unknown[]) => removeMpesaConfigMock(...args),
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/portal/integrations/mpesa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  consumerKey: 'ck', consumerSecret: 'cs', businessShortCode: '174379',
  passkey: 'pk', environment: 'sandbox', callbackUrl: 'https://x.example.com/cb',
};

describe('POST /api/portal/integrations/mpesa', () => {
  beforeEach(() => {
    currentRole = 'admin';
    assertFeatureEnabledMock.mockReset();
    setMpesaConfigMock.mockReset();
    getMpesaConfigSummaryMock.mockReset();
  });

  it('rejects non-admin roles', async () => {
    currentRole = 'portal_user';
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
  });

  it('is blocked when the plan does not include MPESA_INTEGRATION', async () => {
    assertFeatureEnabledMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, code: 'FEATURE_NOT_AVAILABLE', feature: 'MPESA_INTEGRATION' }), { status: 403 }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(setMpesaConfigMock).not.toHaveBeenCalled();
  });

  it('saves the config when the feature is enabled and the caller is admin', async () => {
    assertFeatureEnabledMock.mockResolvedValueOnce(null);
    setMpesaConfigMock.mockResolvedValueOnce(undefined);
    getMpesaConfigSummaryMock.mockResolvedValueOnce({ businessShortCode: '174379', environment: 'sandbox', callbackUrl: validBody.callbackUrl, isActive: true, configuredAt: new Date().toISOString() });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.businessShortCode).toBe('174379');
    expect(setMpesaConfigMock).toHaveBeenCalledWith('org-1', expect.objectContaining({ consumerKey: 'ck', businessShortCode: '174379' }), 'user-1');
  });

  it('rejects a missing required field', async () => {
    assertFeatureEnabledMock.mockResolvedValueOnce(null);
    const { consumerKey: _omit, ...incomplete } = validBody;
    const res = await POST(makeRequest(incomplete));
    expect(res.status).toBe(400);
    expect(setMpesaConfigMock).not.toHaveBeenCalled();
  });
});
