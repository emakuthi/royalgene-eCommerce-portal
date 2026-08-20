import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import { decryptJson, encryptJson } from '../crypto/secret-box.server';

const MPESA_TYPE = 'mpesa';

export interface MpesaCredentials {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
}

export interface MpesaFullConfig extends MpesaCredentials {
  businessShortCode: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
}

/** Non-secret fields only — safe to return to the client. Secrets are write-only once saved. */
export interface MpesaConfigSummary {
  businessShortCode: string | null;
  environment: 'sandbox' | 'production' | null;
  callbackUrl: string | null;
  isActive: boolean;
  configuredAt: string;
}

interface TenantIntegrationConfigRow {
  businessShortCode: string | null;
  environment: 'sandbox' | 'production' | null;
  callbackUrl: string | null;
  encryptedSecrets: string | null;
  isActive: boolean;
  updatedAt: string;
}

export async function getMpesaConfigSummary(organizationId: string): Promise<MpesaConfigSummary | null> {
  const { data } = await supabaseAdmin
    .from('TenantIntegrationConfig')
    .select('businessShortCode, environment, callbackUrl, isActive, updatedAt')
    .eq('organizationId', organizationId)
    .eq('integrationType', MPESA_TYPE)
    .maybeSingle();

  if (!data) return null;
  const row = data as Omit<TenantIntegrationConfigRow, 'encryptedSecrets'>;
  return {
    businessShortCode: row.businessShortCode,
    environment: row.environment,
    callbackUrl: row.callbackUrl,
    isActive: row.isActive,
    configuredAt: row.updatedAt,
  };
}

/** Server-internal only — decrypts credentials. Never expose this to an API response. */
export async function getMpesaConfig(organizationId: string): Promise<MpesaFullConfig | null> {
  const { data } = await supabaseAdmin
    .from('TenantIntegrationConfig')
    .select('businessShortCode, environment, callbackUrl, encryptedSecrets, isActive')
    .eq('organizationId', organizationId)
    .eq('integrationType', MPESA_TYPE)
    .maybeSingle();

  if (!data) return null;
  const row = data as TenantIntegrationConfigRow;
  if (!row.isActive || !row.encryptedSecrets || !row.businessShortCode || !row.environment || !row.callbackUrl) {
    return null;
  }

  const secrets = decryptJson<MpesaCredentials>(row.encryptedSecrets);
  return {
    ...secrets,
    businessShortCode: row.businessShortCode,
    environment: row.environment,
    callbackUrl: row.callbackUrl,
  };
}

export async function setMpesaConfig(
  organizationId: string,
  config: MpesaFullConfig,
  configuredBy?: string | null,
): Promise<void> {
  const encryptedSecrets = encryptJson<MpesaCredentials>({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    passkey: config.passkey,
  });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('TenantIntegrationConfig')
    .upsert(
      [{
        organizationId,
        integrationType: MPESA_TYPE,
        businessShortCode: config.businessShortCode,
        environment: config.environment,
        callbackUrl: config.callbackUrl,
        encryptedSecrets,
        isActive: true,
        configuredBy: configuredBy ?? null,
        updatedAt: now,
      }],
      { onConflict: 'organizationId,integrationType' },
    );

  if (error) throw new Error(error.message);
}

export async function removeMpesaConfig(organizationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('TenantIntegrationConfig')
    .delete()
    .eq('organizationId', organizationId)
    .eq('integrationType', MPESA_TYPE);

  if (error) throw new Error(error.message);
}
