-- Phase 2/4 — synchronisation metadata on the mobile-synced tables.
--
-- Adds the primitives the sync engine needs on the seven entities the Android
-- app reads/writes:
--   Product, Shop, ShopStock, ShopStockVariant, SalesEntry, Alert  (mutable)
--   StockTransaction                                               (append-only)
--
--   deletedAt  timestamptz  -- soft-delete tombstone; the pull feed still
--                              returns tombstoned rows so devices can drop them.
--                              Normal application queries must add
--                              `AND "deletedAt" IS NULL`.
--   version    bigint       -- optimistic-concurrency counter. A conditional
--                              UPDATE ... WHERE version = <client's> detects a
--                              stale write; the BEFORE-UPDATE trigger then
--                              bumps it.
--   updatedAt              -- server-authoritative, refreshed by the trigger;
--                              it is the pull cursor.
--
-- StockTransaction rows are immutable audit records — they get `updatedAt`
-- for a consistent cursor but no `version`/`deletedAt` and no trigger.
--
-- Idempotent.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['Product','Shop','ShopStock','ShopStockVariant','SalesEntry','Alert']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "version" bigint NOT NULL DEFAULT 1', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()', tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("organizationId", "updatedAt")',
                   lower(tbl) || '_org_updated_idx', tbl);
  END LOOP;
END $$;

ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;
UPDATE "StockTransaction" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "StockTransaction" ALTER COLUMN "updatedAt" SET DEFAULT now();
ALTER TABLE "StockTransaction" ALTER COLUMN "updatedAt" SET NOT NULL;
CREATE INDEX IF NOT EXISTS stocktransaction_org_updated_idx
  ON "StockTransaction" ("organizationId", "updatedAt");

-- ── 2. Touch trigger: bump version + updatedAt on every UPDATE ───────────────
CREATE OR REPLACE FUNCTION sync_touch_row() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := now();
  NEW."version"   := COALESCE(OLD."version", 1) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['Product','Shop','ShopStock','ShopStockVariant','SalesEntry','Alert']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_touch ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER sync_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_touch_row()',
      tbl);
  END LOOP;
END $$;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'SalesEntry' AND column_name IN ('deletedAt','version','updatedAt');
