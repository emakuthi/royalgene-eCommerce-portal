// Client helpers for purchase receipts (saved to the owner's Google Drive) — mirrors src/lib/integrations.ts.

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
}

async function request<T>(path: string, token: string | null | undefined, init?: RequestInit): Promise<ApiResult<T>> {
  if (!token) return { ok: false, status: 401, success: false, error: 'Unauthorized' };
  try {
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, success: json?.success, data: json?.data as T, error: json?.error, code: json?.code };
  } catch (err: unknown) {
    return { ok: false, status: 0, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DriveStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  needsReconnect: boolean;
  configured: boolean;
  canManageReceipts: boolean;
  canConnect: boolean;
}

export interface Receipt {
  id: string;
  shopId: string | null;
  expenseId: string | null;
  stockTransactionId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  supplier: string | null;
  amount: number | null;
  currency: string | null;
  receiptDate: string | null;
  notes: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ReceiptFields {
  supplier?: string;
  amount?: string | number;
  currency?: string;
  receiptDate?: string;
  notes?: string;
  shopId?: string;
  expenseId?: string;
  stockTransactionId?: string;
}

export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function getDriveStatus(token?: string | null) {
  return request<DriveStatus>('/api/portal/integrations/google-drive/status', token);
}

export function getDriveConnectUrl(token?: string | null) {
  return request<{ authorizationUrl: string }>('/api/portal/integrations/google-drive/connect', token);
}

export function disconnectDrive(token?: string | null) {
  return request<void>('/api/portal/integrations/google-drive/disconnect', token, { method: 'POST' });
}

export function listReceipts(token: string | null | undefined, filters: { expenseId?: string; from?: string; to?: string; q?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  return request<Receipt[]>(`/api/portal/receipts${qs ? `?${qs}` : ''}`, token);
}

export function uploadReceipt(token: string | null | undefined, file: File, fields: ReceiptFields) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, String(v));
  return request<Receipt>('/api/portal/receipts', token, { method: 'POST', body: form });
}

export function deleteReceipt(token: string | null | undefined, id: string) {
  return request<void>(`/api/portal/receipts/${id}`, token, { method: 'DELETE' });
}

/** The receipt file as an object URL (the route needs the Bearer header, so <img src> can't call it directly). */
export async function fetchReceiptObjectUrl(token: string | null | undefined, id: string): Promise<{ url: string } | { error: string }> {
  if (!token) return { error: 'Unauthorized' };
  try {
    const res = await fetch(`/api/portal/receipts/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { error: json?.error || 'Could not open the receipt' };
    }
    return { url: URL.createObjectURL(await res.blob()) };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
