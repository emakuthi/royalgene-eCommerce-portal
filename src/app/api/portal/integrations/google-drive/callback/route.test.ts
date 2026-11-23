import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const verifyOAuthState = vi.fn();
vi.mock('@/lib/accounting/oauth-state.server', () => ({ verifyOAuthState: (...a: unknown[]) => verifyOAuthState(...a) }));
const exchangeDriveCode = vi.fn();
const ensureFolder = vi.fn();
vi.mock('@/lib/google-drive.server', () => ({
  DRIVE_SCOPES: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
  exchangeDriveCode: (...a: unknown[]) => exchangeDriveCode(...a),
  ensureFolder: (...a: unknown[]) => ensureFolder(...a),
}));
const saveDriveConnection = vi.fn();
vi.mock('@/lib/receipts/drive-connection.server', () => ({ saveDriveConnection: (...a: unknown[]) => saveDriveConnection(...a) }));
vi.mock('@/lib/receipts/receipts.server', () => ({ RECEIPTS_ROOT_FOLDER: 'RoyalTrack Receipts' }));
vi.mock('@/lib/receipts/drive-oauth-urls.server', () => ({ driveCallbackUrl: () => 'https://royalgene.example.test/api/portal/integrations/google-drive/callback' }));
vi.mock('@/lib/organizations.server', () => ({ getOrganizationById: vi.fn(async () => ({ id: 'org-1', slug: 'shop' })) }));
vi.mock('@/lib/urls', () => ({ getOrgUrlFor: (_o: unknown, path: string) => `https://shop.example.test${path}` }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET } from './route';

const call = (qs: string) => GET(new NextRequest(`https://royalgene.example.test/api/portal/integrations/google-drive/callback?${qs}`));
const tokens = (scopes: string[]) => ({ ok: true, data: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, email: 'owner@mailinator.com', grantedScopes: scopes } });

beforeEach(() => {
  vi.clearAllMocks();
  verifyOAuthState.mockReturnValue({ organizationId: 'org-1', userId: 'u-1' });
});

describe('GET google-drive/callback', () => {
  it('saves the connection with a new receipts folder and returns to the workspace', async () => {
    exchangeDriveCode.mockResolvedValue(tokens(['openid', 'email', 'https://www.googleapis.com/auth/drive.file']));
    ensureFolder.mockResolvedValue('folder-1');
    const res = await call('code=c&state=s');
    expect(saveDriveConnection).toHaveBeenCalledWith('org-1', expect.objectContaining({ folderId: 'folder-1', email: 'owner@mailinator.com', refreshToken: 'r', connectedBy: 'u-1' }));
    expect(res.headers.get('location')).toBe('https://shop.example.test/settings?tab=integrations&drive=connected');
  });

  it('refuses when the owner unticked Drive on the consent screen', async () => {
    exchangeDriveCode.mockResolvedValue(tokens(['openid', 'email']));
    const res = await call('code=c&state=s');
    expect(saveDriveConnection).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('drive=no_drive_access');
  });

  it('ignores a forged or expired state', async () => {
    verifyOAuthState.mockReturnValue(null);
    const res = await call('code=c&state=bad');
    expect(exchangeDriveCode).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('drive=error');
  });

  it('reports a cancelled consent', async () => {
    const res = await call('error=access_denied&state=s');
    expect(res.headers.get('location')).toContain('drive=cancelled');
  });
});
