-- Platform tenant management: soft-delete + hard-purge support.
--
-- 1. Organization.deletedAt — soft-delete marker. NULL = live. A soft-deleted
--    org also gets status='cancelled' (middleware already gates that), so the
--    edge tenant resolver needs no change.
--
-- 2. The Phase-1 core tenant tables were created with organizationId FKs set to
--    ON DELETE RESTRICT (see 20260818_03), while every table added later
--    (TenantSubscription, TaxInvoice, TenantIntegrationConfig, …) uses
--    ON DELETE CASCADE. That inconsistency means a hard purge would have to
--    hand-delete ~20 tables in FK order and re-break every time a table is
--    added. This flips the core tables to CASCADE so a purge is a single
--    DELETE FROM "Organization". BillingEvent stays ON DELETE SET NULL
--    (keep the financial audit row, just detach it).
--
-- Idempotent: re-running drops+recreates the same constraints and is a no-op
-- for the column add.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz;

CREATE INDEX IF NOT EXISTS organization_deleted_at_idx ON "Organization" ("deletedAt");

-- Flip core-table organizationId FKs: ON DELETE RESTRICT -> ON DELETE CASCADE.
DO $$
DECLARE
  tbl text;
  conname text;
  tables text[] := ARRAY[
    'User','PortalUser','Shop','Product','ShopStock','StockTransaction',
    'SalesEntry','ProfitMargin','LowStockAlert','Alert','Order','Invoice',
    'Receipt','PaymentDetails','CardDetails','BankTransferDetails','MpesaDetails'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Find the existing FK constraint on this table that targets Organization(id).
    SELECT c.conname INTO conname
    FROM pg_constraint c
    JOIN pg_class t   ON t.oid = c.conrelid
    JOIN pg_class rt  ON rt.oid = c.confrelid
    WHERE c.contype = 'f'
      AND t.relname = tbl
      AND rt.relname = 'Organization'
    LIMIT 1;

    IF conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, conname);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE CASCADE',
        tbl, tbl || '_organizationId_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- snake_case audit tables: detach rather than delete, so a purge doesn't erase
-- the audit trail entirely (org id just becomes NULL).
DO $$
DECLARE
  tbl text;
  conname text;
  tables text[] := ARRAY['activity_logs','audit_logs','user_roles'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.conname INTO conname
    FROM pg_constraint c
    JOIN pg_class t   ON t.oid = c.conrelid
    JOIN pg_class rt  ON rt.oid = c.confrelid
    WHERE c.contype = 'f'
      AND t.relname = tbl
      AND rt.relname = 'Organization'
    LIMIT 1;

    IF conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, conname);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES "Organization"(id) ON DELETE SET NULL',
        tbl, tbl || '_organization_id_fkey'
      );
    END IF;
  END LOOP;
END $$;
