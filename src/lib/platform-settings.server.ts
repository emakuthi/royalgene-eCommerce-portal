import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { decryptSecret, encryptSecret } from './crypto/secret-box.server';

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

/**
 * The build live on Google Play, recorded by hand. 0 = not recorded, including
 * when the column is missing: the minimum-version check must not depend on a
 * migration having been run.
 */
export async function getPlayLiveVersionCode(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('PlatformSettings')
    .select('playLiveVersionCode')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error || !data) return 0;
  const v = Number((data as { playLiveVersionCode?: unknown }).playLiveVersionCode);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

export async function setPlayLiveVersionCode(versionCode: number, updatedBy?: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('PlatformSettings')
    .update({ playLiveVersionCode: versionCode, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(error.message);
}

/**
 * Oldest iOS build still allowed to run. Separate from Android's value because
 * the two apps number their builds independently. Fails OPEN to 0, like
 * getMinAppVersionCode.
 */
export async function getMinIosVersionCode(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('PlatformSettings')
    .select('minIosVersionCode')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error || !data) return 0;
  const v = Number((data as { minIosVersionCode?: unknown }).minIosVersionCode);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

export async function setMinIosVersionCode(versionCode: number, updatedBy?: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('PlatformSettings')
    .update({ minIosVersionCode: versionCode, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error(error.message);
}

// ── WhatsApp sending account ────────────────────────────────────────────────

export const DEFAULT_WHATSAPP_TEMPLATE = 'daily_sales_report';
export const DEFAULT_WHATSAPP_LANG = 'en';

export interface WhatsappConfig {
  phoneNumberId: string;
  accessToken: string;
  template: string;
  language: string;
}

type WhatsappRow = {
  whatsappPhoneNumberId?: string | null;
  whatsappAccessTokenEnc?: string | null;
  whatsappTemplate?: string | null;
  whatsappTemplateLang?: string | null;
};

async function readWhatsappRow(): Promise<WhatsappRow | null> {
  const { data, error } = await supabaseAdmin
    .from('PlatformSettings')
    .select('whatsappPhoneNumberId, whatsappAccessTokenEnc, whatsappTemplate, whatsappTemplateLang')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  // A missing column (migration 20261111_02 not run) reads as "not set here".
  return error ? null : (data as WhatsappRow | null);
}

/**
 * The account messages are sent from: what the platform console saved, else
 * the WHATSAPP_* env vars. Null when neither has a phone number id and token,
 * which keeps all sending off.
 */
export async function getWhatsappConfig(): Promise<WhatsappConfig | null> {
  const row = await readWhatsappRow();
  let accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (row?.whatsappAccessTokenEnc) {
    try {
      accessToken = decryptSecret(row.whatsappAccessTokenEnc);
    } catch {
      // Key missing or changed: the saved token can't be read, so don't send with a stale one.
      accessToken = '';
    }
  }
  const phoneNumberId = row?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    template: row?.whatsappTemplate || process.env.WHATSAPP_DAILY_REPORT_TEMPLATE || DEFAULT_WHATSAPP_TEMPLATE,
    language: row?.whatsappTemplateLang || process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_WHATSAPP_LANG,
  };
}

/** What the console shows: never the token itself, only whether one is saved. */
export async function getWhatsappSettingsView() {
  const row = await readWhatsappRow();
  let tokenReadable = true;
  if (row?.whatsappAccessTokenEnc) {
    try { decryptSecret(row.whatsappAccessTokenEnc); } catch { tokenReadable = false; }
  }
  return {
    available: row !== null,
    phoneNumberId: row?.whatsappPhoneNumberId ?? '',
    hasAccessToken: Boolean(row?.whatsappAccessTokenEnc),
    tokenReadable,
    template: row?.whatsappTemplate || DEFAULT_WHATSAPP_TEMPLATE,
    language: row?.whatsappTemplateLang || DEFAULT_WHATSAPP_LANG,
    configured: (await getWhatsappConfig()) !== null,
  };
}

/**
 * Saves any of the fields given. An accessToken of "" removes it. Throws when
 * the token can't be encrypted (CREDENTIALS_ENCRYPTION_KEY unset) — the token
 * is never stored as plain text.
 */
export async function setWhatsappSettings(
  patch: { phoneNumberId?: string; accessToken?: string; template?: string; language?: string },
  updatedBy?: string | null,
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null };
  if (patch.phoneNumberId !== undefined) update.whatsappPhoneNumberId = patch.phoneNumberId || null;
  if (patch.template !== undefined) update.whatsappTemplate = patch.template || null;
  if (patch.language !== undefined) update.whatsappTemplateLang = patch.language || null;
  if (patch.accessToken !== undefined) update.whatsappAccessTokenEnc = patch.accessToken ? encryptSecret(patch.accessToken) : null;
  const { error } = await supabaseAdmin.from('PlatformSettings').update(update).eq('id', SETTINGS_ID);
  if (error) throw new Error(error.message);
}
