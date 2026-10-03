-- Phase 2: per-transaction currency on sales. Run manually in the Supabase SQL
-- Editor. Backward compatible: new columns are backfilled so every existing KES
-- sale is unchanged and all base-currency aggregates stay identical.
--
--   currency     : the currency the sale was recorded in (default 'KES')
--   exchangeRate : original→base rate FROZEN at sale time (never recalculated)
--   baseAmount   : totalAmount expressed in the tenant base currency
--                  (= totalAmount * exchangeRate). Aggregates sum THIS column.

ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "currency"     text;
ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "exchangeRate" numeric NOT NULL DEFAULT 1;
ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "baseAmount"   numeric;

-- Backfill: existing sales are in their tenant's base currency at rate 1.
UPDATE "SalesEntry" se
  SET currency = COALESCE((SELECT o.currency FROM "Organization" o WHERE o.id = se."organizationId"), 'KES')
  WHERE se.currency IS NULL;
UPDATE "SalesEntry" SET "baseAmount" = "totalAmount" WHERE "baseAmount" IS NULL;

ALTER TABLE "SalesEntry" ALTER COLUMN "currency" SET DEFAULT 'KES';

CREATE INDEX IF NOT EXISTS "SalesEntry_currency_idx" ON "SalesEntry" ("currency");
