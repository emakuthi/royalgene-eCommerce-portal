import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import type { VerifiedPayload } from '../auth.server';
import { hasCapability } from '../permissions.server';
import { assignedShops } from '../shop-access.server';
import { DriveError, downloadFile, ensureFolder, folderIsLive, trashFile, uploadFile } from '../google-drive.server';
import { getDriveAccess, setDriveFolder, type DriveAccess } from './drive-connection.server';
import logger from '../logger';

/**
 * Purchase receipts: the file goes to the workspace's Google Drive (one
 * folder per month inside "RoyalTrack Receipts"); the Receipt row keeps the
 * Drive file id and what the receipt says, linked to an expense or a restock.
 * Shared by the portal and mobile routes.
 */

export const RECEIPTS_ROOT_FOLDER = 'RoyalTrack Receipts';
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface ReceiptDto {
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

export interface ReceiptInput {
  shopId?: string | null;
  expenseId?: string | null;
  stockTransactionId?: string | null;
  supplier?: string | null;
  amount?: number | null;
  currency?: string | null;
  receiptDate?: string | null;
  notes?: string | null;
}

type Fail = { ok: false; status: number; error: string; code?: string };

const DRIVE_PROBLEM: Record<Exclude<DriveAccess, { ok: true }>['reason'], Fail> = {
  not_connected: { ok: false, status: 409, code: 'DRIVE_NOT_CONNECTED', error: 'Google Drive is not connected. The owner can connect it in Settings → Integrations.' },
  reconnect: { ok: false, status: 409, code: 'DRIVE_RECONNECT', error: 'Google Drive needs to be connected again. The owner can reconnect it in Settings → Integrations.' },
  unavailable: { ok: false, status: 503, code: 'DRIVE_UNAVAILABLE', error: 'Google Drive is not responding. Try again in a moment.' },
};

/** Owners and admins always; anyone else needs the "Manage receipts" permission. */
export function canManageReceipts(payload: VerifiedPayload): Promise<boolean> {
  return hasCapability(payload, 'manage_receipts');
}

function toDto(row: Record<string, unknown>): ReceiptDto {
  return {
    id: String(row.id),
    shopId: (row.shopId as string | null) ?? null,
    expenseId: (row.expenseId as string | null) ?? null,
    stockTransactionId: (row.stockTransactionId as string | null) ?? null,
    fileName: String(row.fileName),
    mimeType: String(row.mimeType),
    sizeBytes: Number(row.sizeBytes) || 0,
    supplier: (row.supplier as string | null) ?? null,
    amount: row.amount == null ? null : Number(row.amount),
    currency: (row.currency as string | null) ?? null,
    receiptDate: (row.receiptDate as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    uploadedBy: (row.uploadedBy as string | null) ?? null,
    createdAt: String(row.createdAt),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

/** Validates the editable fields; an unknown expense/restock or a bad date is refused. */
export async function cleanReceiptInput(organizationId: string, raw: Record<string, unknown>): Promise<{ ok: true; value: ReceiptInput } | Fail> {
  const amount = raw.amount === undefined || raw.amount === null || raw.amount === '' ? null : Number(raw.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, status: 400, error: 'Amount must be a positive number' };
  const receiptDate = clean(raw.receiptDate, 10);
  if (receiptDate && !DATE_RE.test(receiptDate)) return { ok: false, status: 400, error: 'Date must be YYYY-MM-DD' };

  const value: ReceiptInput = {
    shopId: clean(raw.shopId, 64),
    expenseId: clean(raw.expenseId, 64),
    stockTransactionId: clean(raw.stockTransactionId, 64),
    supplier: clean(raw.supplier, 200),
    amount: amount === null ? null : Math.round(amount * 100) / 100,
    currency: clean(raw.currency, 8)?.toUpperCase() ?? null,
    receiptDate,
    notes: clean(raw.notes, 1000),
  };

  if (value.expenseId) {
    const { data } = await supabaseAdmin.from('Expense').select('id, shopId').eq('id', value.expenseId).eq('organizationId', organizationId).maybeSingle();
    if (!data) return { ok: false, status: 404, error: 'Expense not found' };
    value.shopId = value.shopId ?? ((data as { shopId?: string | null }).shopId ?? null);
  }
  if (value.stockTransactionId) {
    const { data } = await supabaseAdmin.from('StockTransaction').select('id').eq('id', value.stockTransactionId).eq('organizationId', organizationId).maybeSingle();
    if (!data) return { ok: false, status: 404, error: 'Stock entry not found' };
  }
  if (value.shopId) {
    const { data } = await supabaseAdmin.from('Shop').select('id').eq('id', value.shopId).eq('organizationId', organizationId).maybeSingle();
    if (!data) return { ok: false, status: 404, error: 'Shop not found' };
  }
  return { ok: true, value };
}

/** "2026-11-23 Mama Mboga 1250.jpg" — readable in Drive, safe as a file name. */
export function receiptFileName(input: ReceiptInput, ext: string, today: string): string {
  const parts = [input.receiptDate ?? today, input.supplier ?? 'Receipt', input.amount != null ? String(input.amount) : null]
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${parts}.${ext}`;
}

/** The month folder for a receipt, re-creating "RoyalTrack Receipts" if the owner deleted it. */
async function monthFolder(organizationId: string, access: Extract<DriveAccess, { ok: true }>, month: string): Promise<string> {
  let root = access.folderId;
  if (!(await folderIsLive(access.accessToken, root))) {
    root = await ensureFolder(access.accessToken, RECEIPTS_ROOT_FOLDER);
    await setDriveFolder(organizationId, root);
  }
  return ensureFolder(access.accessToken, month, root);
}

export async function createReceipt(
  organizationId: string,
  uploadedBy: string | null,
  file: { bytes: Uint8Array; mimeType: string },
  input: ReceiptInput,
): Promise<{ ok: true; receipt: ReceiptDto } | Fail> {
  const ext = RECEIPT_MIME_TYPES[file.mimeType];
  if (!ext) return { ok: false, status: 415, error: 'A receipt must be a JPG, PNG, WebP photo or a PDF' };
  if (file.bytes.byteLength === 0) return { ok: false, status: 400, error: 'The file is empty' };
  if (file.bytes.byteLength > MAX_RECEIPT_BYTES) return { ok: false, status: 413, error: 'A receipt can be at most 10 MB' };

  const access = await getDriveAccess(organizationId);
  if (!access.ok) return DRIVE_PROBLEM[access.reason];

  const today = new Date().toISOString().slice(0, 10);
  const fileName = receiptFileName(input, ext, today);
  let driveFileId: string;
  try {
    const parentId = await monthFolder(organizationId, access, (input.receiptDate ?? today).slice(0, 7));
    driveFileId = (await uploadFile(access.accessToken, {
      name: fileName,
      mimeType: file.mimeType,
      parentId,
      bytes: file.bytes,
      description: [input.supplier, input.notes].filter(Boolean).join(' — ') || undefined,
    })).id;
  } catch (err) {
    logger.error('[receipts] Drive upload failed', { organizationId, error: err instanceof Error ? err.message : String(err) });
    return err instanceof DriveError && (err.status === 401 || err.status === 403) ? DRIVE_PROBLEM.reconnect : DRIVE_PROBLEM.unavailable;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('Receipt')
    .insert([{
      organizationId,
      shopId: input.shopId ?? null,
      expenseId: input.expenseId ?? null,
      stockTransactionId: input.stockTransactionId ?? null,
      driveFileId,
      fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      supplier: input.supplier ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      receiptDate: input.receiptDate ?? today,
      notes: input.notes ?? null,
      uploadedBy,
      createdAt: now,
      updatedAt: now,
    }])
    .select('*')
    .single();
  if (error || !data) {
    logger.error('[receipts] saving receipt row failed', { organizationId, driveFileId, error: error?.message });
    return { ok: false, status: 500, error: 'The receipt reached Google Drive but could not be saved. Try again.' };
  }
  return { ok: true, receipt: toDto(data as Record<string, unknown>) };
}

export interface ReceiptFilters {
  from?: string;
  to?: string;
  shopId?: string;
  expenseId?: string;
  stockTransactionId?: string;
  search?: string;
}

/**
 * Receipts this caller may see, newest first: everything for owners, admins
 * and managers; otherwise their assigned shops' receipts plus any they uploaded.
 */
export async function listReceipts(payload: VerifiedPayload, filters: ReceiptFilters, limit = 200): Promise<ReceiptDto[]> {
  let query = supabaseAdmin
    .from('Receipt')
    .select('*')
    .eq('organizationId', payload.organizationId as string)
    .is('deletedAt', null)
    .order('receiptDate', { ascending: false })
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (filters.from && DATE_RE.test(filters.from)) query = query.gte('receiptDate', filters.from);
  if (filters.to && DATE_RE.test(filters.to)) query = query.lte('receiptDate', filters.to);
  if (filters.shopId) query = query.eq('shopId', filters.shopId);
  if (filters.expenseId) query = query.eq('expenseId', filters.expenseId);
  if (filters.stockTransactionId) query = query.eq('stockTransactionId', filters.stockTransactionId);
  const search = filters.search?.replace(/[%,()]/g, ' ').trim();
  if (search) query = query.or(`supplier.ilike.%${search}%,notes.ilike.%${search}%,fileName.ilike.%${search}%`);

  const shops = await assignedShops(payload);
  if (shops) {
    const ids = shops.map((s) => s.id);
    query = ids.length
      ? query.or(`shopId.in.(${ids.join(',')}),uploadedBy.eq.${payload.userId}`)
      : query.eq('uploadedBy', payload.userId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('[receipts] list failed', { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => toDto(r as Record<string, unknown>));
}

/** One receipt the caller may see (same rule as [listReceipts]), with its Drive file id. */
export async function findReceipt(payload: VerifiedPayload, id: string): Promise<(ReceiptDto & { driveFileId: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin
    .from('Receipt')
    .select('*')
    .eq('id', id)
    .eq('organizationId', payload.organizationId as string)
    .is('deletedAt', null)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const shops = await assignedShops(payload);
  if (shops && row.uploadedBy !== payload.userId && !shops.some((s) => s.id === row.shopId)) return null;
  return { ...toDto(row), driveFileId: String(row.driveFileId) };
}

export async function updateReceipt(organizationId: string, id: string, input: ReceiptInput): Promise<ReceiptDto | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of ['shopId', 'expenseId', 'stockTransactionId', 'supplier', 'amount', 'currency', 'receiptDate', 'notes'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  const { data } = await supabaseAdmin.from('Receipt').update(patch).eq('id', id).eq('organizationId', organizationId).is('deletedAt', null).select('*').maybeSingle();
  return data ? toDto(data as Record<string, unknown>) : null;
}

/** Hides the receipt here and moves its file to the Drive bin (the owner can still restore it there). */
export async function deleteReceipt(organizationId: string, receipt: { id: string; driveFileId: string }): Promise<void> {
  await supabaseAdmin.from('Receipt').update({ deletedAt: new Date().toISOString() }).eq('id', receipt.id).eq('organizationId', organizationId);
  const access = await getDriveAccess(organizationId);
  if (!access.ok) return;
  try {
    await trashFile(access.accessToken, receipt.driveFileId);
  } catch (err) {
    logger.warn('[receipts] could not move the file to the Drive bin', { organizationId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** The receipt's bytes from Drive, or why they can't be shown. */
export async function openReceiptFile(organizationId: string, driveFileId: string): Promise<{ ok: true; response: Response } | Fail> {
  const access = await getDriveAccess(organizationId);
  if (!access.ok) return DRIVE_PROBLEM[access.reason];
  try {
    return { ok: true, response: await downloadFile(access.accessToken, driveFileId) };
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) {
      return { ok: false, status: 404, code: 'DRIVE_FILE_GONE', error: 'This receipt was deleted from Google Drive.' };
    }
    if (err instanceof DriveError && (err.status === 401 || err.status === 403)) return DRIVE_PROBLEM.reconnect;
    logger.error('[receipts] Drive download failed', { organizationId, error: err instanceof Error ? err.message : String(err) });
    return DRIVE_PROBLEM.unavailable;
  }
}
