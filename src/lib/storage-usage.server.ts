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
