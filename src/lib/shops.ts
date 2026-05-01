// Lightweight client helper for Shop API calls
export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
  // Optional validation errors map from backend: { fieldName: message }
  validation?: Record<string, string> | null;
}

export async function getShops<T = unknown>(token?: string | null, page = 1, limit = 25): Promise<ApiResult<T>> {
  try {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    const res = await fetch(`/api/portal/shops?${q.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data as T,
      error: json?.error,
      validation: json?.validationErrors ?? json?.errors ?? null,
    } as ApiResult<T>;
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createShop<T = unknown>(token?: string | null, payload?: { name: string; location: string; phone?: string; email?: string; manager?: string | null; }): Promise<ApiResult<T>> {
  if (!token) {
    return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  }
  try {
    const res = await fetch('/api/admin/shops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data as T,
      error: json?.error,
      validation: json?.validationErrors ?? json?.errors ?? null,
    } as ApiResult<T>;
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createShopPortal<T = unknown>(token?: string | null, payload?: { name: string; location: string; phone?: string; email?: string; }): Promise<ApiResult<T>> {
  if (!token) {
    return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  }
  try {
    const res = await fetch('/api/portal/shops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data as T,
      error: json?.error,
      validation: json?.validationErrors ?? json?.errors ?? null,
    } as ApiResult<T>;
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getShopById<T = unknown>(token?: string | null, id?: string): Promise<ApiResult<T>> {
  try {
    const url = id ? `/api/portal/shops/${encodeURIComponent(id)}` : '/api/portal/shops';
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data as T,
      error: json?.error,
      validation: json?.validationErrors ?? json?.errors ?? null,
    } as ApiResult<T>;
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateShop<T = unknown>(token?: string | null, id?: string, payload?: { name?: string; location?: string; phone?: string; email?: string; manager?: string | null; }): Promise<ApiResult<T>> {
  if (!token) {
    return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  }
  if (!id) {
    return { ok: false, status: 400, success: false, error: 'Missing id' };
  }

  try {
    // Try admin endpoint first
    let res = await fetch(`/api/admin/shops/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    let json = await res.json().catch(() => ({}));

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      // fallback to portal endpoint
      res = await fetch(`/api/portal/shops/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      json = await res.json().catch(() => ({}));
    }

    return {
      ok: res.ok,
      status: res.status,
      success: json?.success,
      data: json?.data as T,
      error: json?.error,
      validation: json?.validationErrors ?? json?.errors ?? null,
    } as ApiResult<T>;
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
