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
