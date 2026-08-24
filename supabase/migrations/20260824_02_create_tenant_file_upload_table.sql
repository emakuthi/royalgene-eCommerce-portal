-- Storage metering: migration 1 of 1. Backs LimitCode.STORAGE_GB (previously
-- "defined only" — no per-tenant file-size accounting existed). Append-only
-- ledger, one row per successful upload; usage is SUM(sizeBytes) WHERE
-- "deletedAt" IS NULL. "deletedAt" exists for when image deletion is wired
-- up (deleteProductImage() in src/lib/image-utils.ts currently has zero
-- callers, so nothing decrements this today — usage only grows for now).
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "TenantFileUpload" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  bucket           text NOT NULL,
  "storagePath"    text NOT NULL,
  "sizeBytes"      bigint NOT NULL,
  "contentType"    text,
  "uploadedBy"     text,
  "deletedAt"      timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_file_upload_org_idx
  ON "TenantFileUpload" ("organizationId") WHERE "deletedAt" IS NULL;
