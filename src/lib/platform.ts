// Lightweight client helpers for the platform (super_admin) console — mirrors src/lib/shops.ts's pattern.
import type { Organization, PlatformPlan } from './types';
import type { DomainState } from './domains';

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

export interface PlatformCapacity {
  totalTenants: number;
  totalUsers: number;
  totalShops: number;
  totalProducts: number;
  monthlyTransactions: number;
  totalStorageBytes: number;
  tenantsNearingLimit: Array<{
    organizationId: string;
    organizationName: string;
    limitCode: string;
    threshold: number;
    notifiedAt: string;
  }>;
}

export function getPlatformCapacity(token?: string | null) {
  return request<PlatformCapacity>('/api/platform/capacity', token);
}

export function listPlatformOrganizations(token?: string | null, opts: { includeDeleted?: boolean } = {}) {
  const qs = opts.includeDeleted ? '?includeDeleted=true' : '';
  return request<OrganizationWithCounts[]>(`/api/platform/organizations${qs}`, token);
}

export function updatePlatformOrganization(
  token: string | null | undefined,
  id: string,
  payload: { name?: string; status?: Organization['status']; planTier?: Organization['planTier'] },
) {
  return request<Organization>(`/api/platform/organizations/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Soft delete by default; { purge: true, confirm: "<slug>" } permanently removes all tenant data. */
export function deletePlatformOrganization(
  token: string | null | undefined,
  id: string,
  opts: { purge?: boolean; confirm?: string } = {},
) {
  const qs = opts.purge ? '?purge=true' : '';
  return request<Organization | null>(`/api/platform/organizations/${encodeURIComponent(id)}${qs}`, token, {
    method: 'DELETE',
    ...(opts.purge ? { body: JSON.stringify({ confirm: opts.confirm ?? '' }) } : {}),
  });
}

export function restorePlatformOrganization(token: string | null | undefined, id: string) {
  return request<Organization>(`/api/platform/organizations/${encodeURIComponent(id)}/restore`, token, {
    method: 'POST',
  });
}

export function getPlatformOrgDomain(token: string | null | undefined, id: string) {
  return request<DomainState>(`/api/platform/organizations/${encodeURIComponent(id)}/domain`, token);
}

export function setPlatformOrgDomain(token: string | null | undefined, id: string, domain: string) {
  return request<DomainState>(`/api/platform/organizations/${encodeURIComponent(id)}/domain`, token, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export function removePlatformOrgDomain(token: string | null | undefined, id: string) {
  return request<null>(`/api/platform/organizations/${encodeURIComponent(id)}/domain`, token, {
    method: 'DELETE',
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
  tier: 'starter' | 'business' | 'pro' | 'enterprise';
  code?: string;
  name: string;
  description?: string;
  monthlyPriceKobo: number;
  annualPriceKobo: number;
  monthlyPriceUSD?: number | null;
  annualPriceUSD?: number | null;
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

export interface PlanEntitlementRow {
  id: string;
  planId: string;
  code: string;
  limitValue: number | null;
  enabled: boolean;
}

export function getPlanEntitlements(token: string | null | undefined, planId: string) {
  return request<PlanEntitlementRow[]>(`/api/platform/plans/${encodeURIComponent(planId)}/entitlements`, token);
}

export function updatePlanEntitlements(
  token: string | null | undefined,
  planId: string,
  patches: { code: string; enabled?: boolean; limitValue?: number | null }[],
) {
  return request<PlanEntitlementRow[]>(`/api/platform/plans/${encodeURIComponent(planId)}/entitlements`, token, {
    method: 'PATCH',
    body: JSON.stringify({ patches }),
  });
}

export function getOrganizationSubscription(token: string | null | undefined, organizationId: string) {
  return request<unknown>(`/api/platform/organizations/${encodeURIComponent(organizationId)}/subscription`, token);
}

export type SubscriptionAction =
  | { action: 'assignPlan'; planId: string; status?: string; billingInterval?: 'monthly' | 'annually' | null }
  | { action: 'extendTrial'; extraDays: number }
  | { action: 'suspend' }
  | { action: 'reactivate' };

export function manageOrganizationSubscription(token: string | null | undefined, organizationId: string, body: SubscriptionAction) {
  return request<unknown>(`/api/platform/organizations/${encodeURIComponent(organizationId)}/subscription`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
