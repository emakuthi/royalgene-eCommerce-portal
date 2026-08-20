-- QuickBooks integration: migration 4 of 4.
-- One row per sync attempt (not per SalesEntry — a retry would add another
-- row), giving visibility into sync history without touching SalesEntry's
-- schema.
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "AccountingSyncLog" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "salesEntryId"   text NOT NULL, -- SalesEntry.id is a legacy text PK, not uuid
  provider         text NOT NULL,
  status           text NOT NULL CHECK (status IN ('synced', 'failed', 'skipped')),
  "externalId"     text, -- QuickBooks SalesReceipt Id on success
  "errorMessage"   text,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_sync_log_org_idx ON "AccountingSyncLog" ("organizationId");
CREATE INDEX IF NOT EXISTS accounting_sync_log_sales_entry_idx ON "AccountingSyncLog" ("salesEntryId");
