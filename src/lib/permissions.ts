// Lightweight client helpers for the "define permissions per role" screen
// (Settings -> Permissions tab) — mirrors src/lib/billing.ts's pattern.

export type EditableRole = 'shop_manager' | 'shopkeeper' | 'cashier' | 'assistant';
export type Capability = 'view_cost_price' | 'add_inventory' | 'edit_inventory' | 'delete_inventory' | 'record_sales' | 'manage_staff';

export interface PermissionCatalogEntry {
  key: Capability;
  label: string;
  description: string;
}

export type PermissionMatrix = Record<EditableRole, Record<Capability, boolean>>;

export interface PermissionsData {
  roles: EditableRole[];
  capabilities: PermissionCatalogEntry[];
  matrix: PermissionMatrix;
}

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

export function getPermissionsMatrix(token?: string | null) {
  return request<PermissionsData>('/api/portal/permissions', token);
}

export function setPermission(token: string | null | undefined, role: EditableRole, permission: Capability, enabled: boolean) {
  return request<{ matrix: PermissionMatrix }>('/api/portal/permissions', token, {
    method: 'PUT',
    body: JSON.stringify({ role, permission, enabled }),
  });
}
