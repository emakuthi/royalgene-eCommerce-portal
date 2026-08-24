import 'server-only';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';

const BYTES_PER_GB = 1024 ** 3;

/**
 * Live SUM of undeleted upload sizes for a tenant — same "no cached
 * counters yet, app scale doesn't warrant them" approach as the other
 * live-COUNT usage checks in entitlement-service.server.ts.
 */
export async function getStorageUsageBytes(organizationId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('TenantFileUpload')
    .select('sizeBytes')
    .eq('organizationId', organizationId)
    .is('deletedAt', null);

  return (data ?? []).reduce((sum, row) => sum + Number((row as { sizeBytes: number }).sizeBytes ?? 0), 0);
}

export async function getStorageUsageGB(organizationId: string): Promise<number> {
  const bytes = await getStorageUsageBytes(organizationId);
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

/**
 * Called after a successful Supabase Storage upload. Failure here is logged
 * but never fails the request — the file is already uploaded; returning an
 * error at this point would orphan it with no clean way to retry.
 */
export async function recordFileUpload(params: {
  organizationId: string;
  bucket: string;
  storagePath: string;
  sizeBytes: number;
  contentType?: string | null;
  uploadedBy?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('TenantFileUpload').insert([
    {
      organizationId: params.organizationId,
      bucket: params.bucket,
      storagePath: params.storagePath,
      sizeBytes: params.sizeBytes,
      contentType: params.contentType ?? null,
      uploadedBy: params.uploadedBy ?? null,
    },
  ]);

  if (error) {
    logger.error('[storage-usage] Failed to record file upload for storage metering', { error: error.message });
  }
}

const STORAGE_URL_PATTERN = /\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(?:\?|$)/;

/** Extracts {bucket, path} from a public Supabase Storage URL, or null if the URL doesn't match that shape. */
export function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const match = url.match(STORAGE_URL_PATTERN);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

/**
 * Deletes a file from Supabase Storage and marks the matching
 * TenantFileUpload row deleted so per-tenant storage usage reflects the
 * removal. Best-effort like recordFileUpload — failures are logged, never
 * thrown, since by the time this is called the caller's own primary write
 * (e.g. the product update) has already succeeded and shouldn't be
 * rolled back over a storage-cleanup problem. Safe to call with a URL that
 * predates tenant-prefixed paths or isn't tracked in the ledger at all
 * (e.g. seeded/legacy images) — it still deletes from Storage, just has no
 * ledger row to mark.
 */
export async function deleteUploadedFile(url: string, organizationId?: string | null): Promise<void> {
  const parsed = parseStorageUrl(url);
  if (!parsed) return;

  const { error: storageError } = await supabaseAdmin.storage.from(parsed.bucket).remove([parsed.path]);
  if (storageError) {
    logger.error('[storage-usage] Failed to delete file from storage', { error: storageError.message, path: parsed.path });
  }

  let query = supabaseAdmin
    .from('TenantFileUpload')
    .update({ deletedAt: new Date().toISOString() })
    .eq('storagePath', parsed.path)
    .is('deletedAt', null);
  if (organizationId) query = query.eq('organizationId', organizationId);

  const { error: ledgerError } = await query;
  if (ledgerError) {
    logger.error('[storage-usage] Failed to mark file deleted in usage ledger', { error: ledgerError.message, path: parsed.path });
  }
}

export async function deleteUploadedFiles(urls: string[], organizationId?: string | null): Promise<void> {
  await Promise.all(urls.map((url) => deleteUploadedFile(url, organizationId)));
}
