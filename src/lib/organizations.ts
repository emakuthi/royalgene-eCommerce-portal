// Lightweight client helper for Organization API calls — mirrors src/lib/shops.ts's pattern.
import type { Organization } from './types';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
}

export async function checkSlugAvailable(slug: string): Promise<ApiResult<{ available: boolean }>> {
  try {
    const res = await fetch(`/api/auth/check-slug?slug=${encodeURIComponent(slug)}`);
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data,
      error: json?.error,
    };
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCurrentOrganization(token?: string | null): Promise<ApiResult<Organization>> {
  if (!token) return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  try {
    const res = await fetch('/api/portal/organization', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, success: json?.success, data: json?.data as Organization, error: json?.error };
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
