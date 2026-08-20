// Lightweight client helpers for tenant integration configuration (Settings -> Integrations tab) — mirrors src/lib/billing.ts's pattern.

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
}

async function request<T>(path: string, token: string | null | undefined, init?: RequestInit): Promise<ApiResult<T>> {
  if (!token) return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, success: json?.success, data: json?.data as T, error: json?.error };
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MpesaConfigSummary {
  businessShortCode: string | null;
  environment: 'sandbox' | 'production' | null;
  callbackUrl: string | null;
  isActive: boolean;
  configuredAt: string;
}

export interface SetMpesaConfigInput {
  consumerKey: string;
  consumerSecret: string;
  businessShortCode: string;
  passkey: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
}

export function getMpesaConfig(token?: string | null) {
  return request<MpesaConfigSummary | null>('/api/portal/integrations/mpesa', token);
}

export function setMpesaConfig(token: string | null | undefined, input: SetMpesaConfigInput) {
  return request<MpesaConfigSummary>('/api/portal/integrations/mpesa', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeMpesaConfig(token?: string | null) {
  return request<null>('/api/portal/integrations/mpesa', token, { method: 'DELETE' });
}

// ── eTIMS tax profile ────────────────────────────────────────────────────

export function getTaxProfile(token?: string | null) {
  return request<{ kraPin: string | null }>('/api/portal/tax-profile', token);
}

export function setTaxProfile(token: string | null | undefined, kraPin: string) {
  return request<{ kraPin: string }>('/api/portal/tax-profile', token, {
    method: 'PATCH',
    body: JSON.stringify({ kraPin }),
  });
}

// ── QuickBooks ───────────────────────────────────────────────────────────

export interface QuickBooksStatus {
  connected: boolean;
  realmId: string | null;
  connectedAt: string | null;
  platformConfigured: boolean;
}

export function getQuickBooksStatus(token?: string | null) {
  return request<QuickBooksStatus>('/api/portal/integrations/quickbooks/status', token);
}

export function getQuickBooksAuthorizationUrl(token?: string | null) {
  return request<{ authorizationUrl: string }>('/api/portal/integrations/quickbooks/connect', token);
}

export function disconnectQuickBooks(token?: string | null) {
  return request<null>('/api/portal/integrations/quickbooks/disconnect', token, { method: 'POST' });
}
