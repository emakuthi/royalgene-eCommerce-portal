-- Entitlement system: migration 1 of 5.
-- Adds a stable plan code (independent of `tier`, which stays as-is — no
-- rename of starter/pro/enterprise) and display-only USD prices, and allows
-- the new 'business' plan tier on Organization.
--
-- Run manually via the Supabase SQL Editor (direct psql is unreachable over
-- IPv6 from this environment, same as every prior migration).

ALTER TABLE "PlatformPlan" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE "PlatformPlan" ADD COLUMN IF NOT EXISTS "monthlyPriceUSD" integer;
ALTER TABLE "PlatformPlan" ADD COLUMN IF NOT EXISTS "annualPriceUSD" integer;

CREATE UNIQUE INDEX IF NOT EXISTS platform_plan_code_unique_idx ON "PlatformPlan" ("code") WHERE "code" IS NOT NULL;

-- Drop whatever the existing planTier CHECK constraint is actually named
-- (Postgres auto-names it, and we don't want to guess wrong) and replace it.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'Organization'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%planTier%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Organization" DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planTier_check"
    CHECK ("planTier" IN ('free', 'starter', 'business', 'pro', 'enterprise', 'legacy'));
END $$;
