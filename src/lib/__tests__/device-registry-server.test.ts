import { describe, it, expect, vi } from 'vitest';

// Same generic thenable supabase-builder stand-in used by the mobile route
// tests: every chain method returns the same object, itself awaitable.
function chainable(resolveValue: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'upsert', 'is', 'order']) {
    obj[m] = vi.fn(() => obj);
  }
  obj.maybeSingle = vi.fn(async () => resolveValue);
  (obj as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).then(resolve, reject);
  return obj;
}

const state = { result: { data: null as unknown, error: null as { message: string } | null } };

const fromMock = vi.fn((_table: string) => chainable(state.result));

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...(args as [string])) },
}));

import {
  deviceInfoFromBody,
  registerDevice,
  listDevices,
  revokeDevice,
  isDeviceRevoked,
} from '../device-registry.server';

describe('deviceInfoFromBody', () => {
  it('returns undefined when deviceId is missing or blank', () => {
    expect(deviceInfoFromBody({})).toBeUndefined();
    expect(deviceInfoFromBody({ deviceId: '' })).toBeUndefined();
    expect(deviceInfoFromBody({ deviceId: '   ' })).toBeUndefined();
    expect(deviceInfoFromBody({ deviceId: 42 })).toBeUndefined();
  });

  it('parses device fields, defaulting platform to android and trimming deviceId', () => {
    const info = deviceInfoFromBody({ deviceId: ' abc-123 ', deviceName: 'Pixel 8', appVersion: '1.2.3' });
    expect(info).toEqual({ deviceId: 'abc-123', deviceName: 'Pixel 8', platform: 'android', appVersion: '1.2.3' });
  });
});

describe('registerDevice / listDevices / revokeDevice / isDeviceRevoked', () => {
  it('registerDevice upserts on (userId, deviceId) without throwing on a DB error', async () => {
    state.result = { data: null, error: { message: 'boom' } };
    await expect(
      registerDevice('org-1', 'user-1', { deviceId: 'device-1' }),
    ).resolves.toBeUndefined();
    expect(fromMock).toHaveBeenCalledWith('Device');
  });

  it('listDevices returns [] on a DB error rather than throwing', async () => {
    state.result = { data: null, error: { message: 'boom' } };
    await expect(listDevices('user-1')).resolves.toEqual([]);
  });

  it('listDevices returns the rows on success', async () => {
    const rows = [{ id: 'd1', deviceId: 'device-1', deviceName: 'Pixel', platform: 'android', appVersion: '1.0', lastActiveAt: 't', createdAt: 't', revokedAt: null }];
    state.result = { data: rows, error: null };
    await expect(listDevices('user-1')).resolves.toEqual(rows);
  });

  it('revokeDevice returns true when a row was updated, false when none matched', async () => {
    state.result = { data: [{ id: 'd1' }], error: null };
    await expect(revokeDevice('user-1', 'device-1')).resolves.toBe(true);

    state.result = { data: [], error: null };
    await expect(revokeDevice('user-1', 'device-1')).resolves.toBe(false);
  });

  it('isDeviceRevoked fails open (false) when no row exists for this device', async () => {
    state.result = { data: null, error: null };
    await expect(isDeviceRevoked('user-1', 'device-1')).resolves.toBe(false);
  });

  it('isDeviceRevoked is true only when the row has a non-null revokedAt', async () => {
    state.result = { data: { revokedAt: null }, error: null };
    await expect(isDeviceRevoked('user-1', 'device-1')).resolves.toBe(false);

    state.result = { data: { revokedAt: '2026-09-12T00:00:00.000Z' }, error: null };
    await expect(isDeviceRevoked('user-1', 'device-1')).resolves.toBe(true);
  });
});
