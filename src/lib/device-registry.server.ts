import 'server-only';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';

export interface DeviceInfo {
  /** Client-generated stable UUID, one per app install. */
  deviceId: string;
  deviceName?: string | null;
  platform?: string;
  appVersion?: string | null;
}

export interface DeviceRow {
  id: string;
  deviceId: string;
  deviceName: string | null;
  platform: string;
  appVersion: string | null;
  lastActiveAt: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Pulls optional device fields out of a mobile auth request body.
 * `deviceId` absent/blank -> undefined, meaning "this caller doesn't know
 * about device identity yet" (an older app build, or a non-mobile caller)
 * — every auth entry point treats that the same as before this feature
 * existed: no token claim, no registry row, nothing to revoke.
 */
export function deviceInfoFromBody(body: Record<string, unknown>): DeviceInfo | undefined {
  const deviceId = body.deviceId;
  if (typeof deviceId !== 'string' || !deviceId.trim()) return undefined;
  return {
    deviceId: deviceId.trim(),
    deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
    platform: typeof body.platform === 'string' ? body.platform : 'android',
    appVersion: typeof body.appVersion === 'string' ? body.appVersion : null,
  };
}

/**
 * Upserts the device row for a successful login/register/signup and
 * clears any prior revocation — a fresh, credential-verified sign-in is
 * itself proof of legitimate access, so "revoked" only means "signed out
 * as of the last session," not "permanently blocked." Best-effort: a
 * failure here must never fail the auth flow it's called from.
 */
export async function registerDevice(
  organizationId: string,
  userId: string,
  device: DeviceInfo,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('Device')
    .upsert(
      [{
        organizationId,
        userId,
        deviceId: device.deviceId,
        deviceName: device.deviceName ?? null,
        platform: device.platform ?? 'android',
        appVersion: device.appVersion ?? null,
        lastActiveAt: now,
        revokedAt: null,
      }],
      { onConflict: 'userId,deviceId' },
    );

  if (error) {
    logger.warn('registerDevice: upsert failed (non-fatal, auth flow continues)', {
      userId, deviceId: device.deviceId, error: error.message,
    });
  }
}

/** All devices for one user, most recently active first. */
export async function listDevices(userId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('Device')
    .select('id, deviceId, deviceName, platform, appVersion, lastActiveAt, createdAt, revokedAt')
    .eq('userId', userId)
    .order('lastActiveAt', { ascending: false });

  if (error) {
    logger.error('listDevices failed', { userId, error: error.message });
    return [];
  }
  return (data ?? []) as DeviceRow[];
}

/** @return true if a row was found and revoked; false if no such (active) device exists for this user. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('Device')
    .update({ revokedAt: new Date().toISOString() })
    .eq('userId', userId)
    .eq('deviceId', deviceId)
    .is('revokedAt', null)
    .select('id');

  if (error) {
    logger.error('revokeDevice failed', { userId, deviceId, error: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Fail OPEN when no row is found for this (userId, deviceId) pair — a
 * token issued before this feature existed, or one signed with no
 * deviceId claim, must keep working exactly as before. Only a row that
 * exists AND is explicitly revoked blocks the request.
 */
export async function isDeviceRevoked(userId: string, deviceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Device')
    .select('revokedAt')
    .eq('userId', userId)
    .eq('deviceId', deviceId)
    .maybeSingle();

  return data?.revokedAt != null;
}
