import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// role: 'super_admin' makes assertTenantMatch (real, unmocked) short-circuit
// to null regardless of the x-org-id header — keeps this test focused on
// the device-revocation check, not tenant-header plumbing.
const basePayload = { userId: 'user-1', role: 'super_admin', organizationId: null as string | null };

const verifyTokenMock = vi.fn();
const isDeviceRevokedMock = vi.fn();

vi.mock('@/lib/auth.server', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

vi.mock('@/lib/device-registry.server', () => ({
  isDeviceRevoked: (...args: unknown[]) => isDeviceRevokedMock(...args),
}));

import { verifyMobileAuth } from '../mobile-shop-auth';

function makeRequest() {
  return new NextRequest('http://localhost/api/mobile/whatever', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('verifyMobileAuth — device revocation', () => {
  it('proceeds normally when the token carries no deviceId claim (never checks revocation)', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload });

    const result = await verifyMobileAuth(makeRequest());

    expect(isDeviceRevokedMock).not.toHaveBeenCalled();
    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      expect(result.payload.userId).toBe('user-1');
    }
  });

  it('rejects with 401 DEVICE_REVOKED when the token’s device has been revoked', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload, deviceId: 'device-1' });
    isDeviceRevokedMock.mockResolvedValue(true);

    const result = await verifyMobileAuth(makeRequest());

    expect(isDeviceRevokedMock).toHaveBeenCalledWith('user-1', 'device-1');
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json.code).toBe('DEVICE_REVOKED');
    }
  });

  it('proceeds normally when the token carries a deviceId that is not revoked', async () => {
    verifyTokenMock.mockReturnValue({ ...basePayload, deviceId: 'device-1' });
    isDeviceRevokedMock.mockResolvedValue(false);

    const result = await verifyMobileAuth(makeRequest());

    expect(result).not.toBeInstanceOf(Response);
  });
});
