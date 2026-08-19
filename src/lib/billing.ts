// Lightweight client helpers for tenant-facing billing (Settings -> Billing tab) — mirrors src/lib/platform.ts's pattern.
import type { Organization, PlatformPlan, TenantSubscription } from './types';
import type { FeatureCodeValue, LimitCodeValue } from './entitlements/feature-codes';

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

export function listBillingPlans(token?: string | null) {
  return request<PlatformPlan[]>('/api/portal/billing/plans', token);
}

export function startBillingCheckout(token: string | null | undefined, planId: string, interval: 'monthly' | 'annually') {
  return request<{ checkoutUrl: string; reference: string }>('/api/portal/billing/checkout', token, {
    method: 'POST',
    body: JSON.stringify({ planId, interval }),
  });
}

export function verifyBillingReference(token: string | null | undefined, reference: string) {
  return request<{ status: string; organization?: Organization }>(`/api/portal/billing/verify?reference=${encodeURIComponent(reference)}`, token);
}

export interface SubscriptionSnapshot {
  subscription: TenantSubscription | null;
  plan: PlatformPlan | null;
  isLegacyUnlimited: boolean;
  isRestricted: boolean;
}

export function getBillingSubscription(token?: string | null) {
  return request<SubscriptionSnapshot>('/api/portal/billing/subscription', token);
}

export interface UsageSnapshot {
  limits: Partial<Record<LimitCodeValue, { limit: number | null; usage: number; remaining: number | null }>>;
  plan: { id: string; code: string | null; name: string; tier: string } | null;
  subscription: { status: string; trialEnd: string | null; currentPeriodEnd: string | null };
}

export function getBillingUsage(token?: string | null) {
  return request<UsageSnapshot>('/api/portal/billing/usage', token);
}

export interface FeaturesSnapshot {
  features: Partial<Record<FeatureCodeValue, boolean>>;
  plan: { id: string; code: string | null; name: string; tier: string } | null;
}

export function getBillingFeatures(token?: string | null) {
  return request<FeaturesSnapshot>('/api/portal/billing/features', token);
}

export function cancelBillingSubscription(token?: string | null) {
  return request<TenantSubscription>('/api/portal/billing/cancel', token, { method: 'POST' });
}

export interface PublicPlan extends PlatformPlan {
  entitlements: { code: string; enabled: boolean; limitValue: number | null }[];
}

/** No auth required — powers the public pricing page (landing + /pricing). */
export async function listPublicPlans(): Promise<ApiResult<PublicPlan[]>> {
  try {
    const res = await fetch('/api/plans');
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, success: json?.success, data: json?.data, error: json?.error };
  } catch (err) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
