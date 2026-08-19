// Lightweight client helpers for tenant-facing billing (Settings -> Billing tab) — mirrors src/lib/platform.ts's pattern.
import type { Organization, PlatformPlan } from './types';

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
