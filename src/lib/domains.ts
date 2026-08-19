// Lightweight client helpers for the tenant-facing custom domain settings tab — mirrors src/lib/billing.ts's pattern.

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
}

export interface DomainInstructions {
  cnameTarget: string;
  aRecordTarget: string;
  verification: { type: string; domain: string; value: string }[];
}

export interface DomainState {
  domain: string | null;
  status: 'pending' | 'verified' | 'misconfigured' | null;
  instructions: DomainInstructions | null;
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

export function getDomainState(token?: string | null) {
  return request<DomainState>('/api/portal/domain', token);
}

export function setDomain(token: string | null | undefined, domain: string) {
  return request<DomainState>('/api/portal/domain', token, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export function removeDomain(token: string | null | undefined) {
  return request<null>('/api/portal/domain', token, { method: 'DELETE' });
}
