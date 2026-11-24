import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mobileReceiptsAuth = vi.fn();
vi.mock('@/lib/receipts/mobile-auth.server', () => ({ mobileReceiptsAuth: (...a: unknown[]) => mobileReceiptsAuth(...a) }));
const signOAuthState = vi.fn(() => 'signed');
vi.mock('@/lib/accounting/oauth-state.server', () => ({ signOAuthState: (...a: unknown[]) => signOAuthState(...(a as [])) }));
vi.mock('@/lib/google-drive.server', () => ({
  isDriveConfigured: () => true,
  driveAuthUrl: (redirect: string, state: string) => `https://accounts.google.test/auth?redirect_uri=${redirect}&state=${state}`,
}));
vi.mock('@/lib/receipts/drive-oauth-urls.server', () => ({ driveCallbackUrl: () => 'https://royalgene.example.test/cb' }));

import { GET } from './route';

const call = () => GET(new NextRequest('https://royalgene.example.test/api/mobile/receipts/connect'));

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/mobile/receipts/connect', () => {
  it("gives the owner Google's consent URL, marked as started from the app", async () => {
    mobileReceiptsAuth.mockResolvedValue({ organizationId: 'org-1', userId: 'u-1', role: 'admin' });
    const res = await call();
    const body = await res.json();
    expect(body.data.authorizationUrl).toContain('state=signed');
    expect(signOAuthState).toHaveBeenCalledWith('org-1', 'u-1', { app: true });
  });

  it('refuses staff', async () => {
    mobileReceiptsAuth.mockResolvedValue({ organizationId: 'org-1', userId: 'u-2', role: 'shopkeeper' });
    const res = await call();
    expect(res.status).toBe(403);
    expect(signOAuthState).not.toHaveBeenCalled();
  });
});
