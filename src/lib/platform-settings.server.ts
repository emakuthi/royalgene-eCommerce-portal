import 'server-only';
import { supabaseAdmin } from './supabase-client';

const SETTINGS_ID = 'singleton';

export async function getSelfSignupEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('PlatformSettings')
    .select('selfSignupEnabled')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  // Fail open to "enabled" only if the row is simply missing (e.g. migration
  // not yet run) — matches the pre-existing default behavior of signup
  // always being on.
  return data ? Boolean(data.selfSignupEnabled) : true;
}

export async function setSelfSignupEnabled(enabled: boolean, updatedBy?: string | null): Promise<void> {
  await supabaseAdmin
    .from('PlatformSettings')
    .update({ selfSignupEnabled: enabled, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null })
    .eq('id', SETTINGS_ID);
}

/**
 * When true, the per-user mobile-access gate in buildMobileAuthResponse is
 * bypassed (see that function). Fails CLOSED to false if the row/column is
 * missing — a security gate must never be silently off due to a un-run
 * migration.
 */
export async function getAllowAllMobileLogins(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('PlatformSettings')
    .select('allowAllMobileLogins')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  return data ? Boolean((data as { allowAllMobileLogins?: boolean }).allowAllMobileLogins) : false;
}

export async function setAllowAllMobileLogins(enabled: boolean, updatedBy?: string | null): Promise<void> {
  await supabaseAdmin
    .from('PlatformSettings')
    .update({ allowAllMobileLogins: enabled, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null })
    .eq('id', SETTINGS_ID);
}

/**
 * Oldest app versionCode still allowed to run — older builds are blocked
 * until updated. 0 = no minimum. Fails OPEN to 0 when the row/column is
 * missing: a force-update gate must never lock everyone out because a
 * migration hasn't been run.
 */
export async function getMinAppVersionCode(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('PlatformSettings')
    .select('minAppVersionCode')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error || !data) return 0;
  const v = Number((data as { minAppVersionCode?: unknown }).minAppVersionCode);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

export async function setMinAppVersionCode(versionCode: number, updatedBy?: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('PlatformSettings')
    .update({ minAppVersionCode: versionCode, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(error.message);
}
