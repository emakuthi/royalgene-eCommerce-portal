// Lightweight client helpers for the platform (super_admin) console — mirrors src/lib/shops.ts's pattern.
import type { Organization, PlatformPlan } from './types';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
}

export interface OrganizationWithCounts extends Organization {
  userCount: number;
  shopCount: number;
}

export interface PlatformOverview {
  totalOrganizations: number;
  organizationsByStatus: Record<Organization['status'], number>;
  totalUsers: number;
  totalShops: number;
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

export function getPlatformOverview(token?: string | null) {
  return request<PlatformOverview>('/api/platform/overview', token);
}

export function listPlatformOrganizations(token?: string | null) {
  return request<OrganizationWithCounts[]>('/api/platform/organizations', token);
}

export function updatePlatformOrganization(
  token: string | null | undefined,
  id: string,
  payload: { status?: Organization['status']; planTier?: Organization['planTier'] },
) {
  return request<Organization>(`/api/platform/organizations/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getPlatformSelfSignupEnabled(token?: string | null) {
  return request<{ selfSignupEnabled: boolean }>('/api/platform/settings', token);
}

export function setPlatformSelfSignupEnabled(token: string | null | undefined, selfSignupEnabled: boolean) {
  return request<{ selfSignupEnabled: boolean }>('/api/platform/settings', token, {
    method: 'PATCH',
    body: JSON.stringify({ selfSignupEnabled }),
  });
}

export function listPlatformPlans(token?: string | null) {
  return request<PlatformPlan[]>('/api/platform/plans', token);
}

export interface CreatePlatformPlanInput {
  tier: 'starter' | 'pro' | 'enterprise';
  name: string;
  description?: string;
  monthlyPriceKobo: number;
  annualPriceKobo: number;
  maxShops?: number | null;
  maxUsers?: number | null;
  displayOrder?: number;
}

export function createPlatformPlan(token: string | null | undefined, payload: CreatePlatformPlanInput) {
  return request<PlatformPlan>('/api/platform/plans', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePlatformPlan(
  token: string | null | undefined,
  id: string,
  payload: Partial<Pick<PlatformPlan, 'name' | 'description' | 'maxShops' | 'maxUsers' | 'isActive' | 'displayOrder'>>,
) {
  return request<PlatformPlan>(`/api/platform/plans/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
