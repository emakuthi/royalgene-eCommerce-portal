-- ExchangeRate: bring the live (VPS) table in line with 20261003_01.
--
-- The live table was created from an earlier draft: "organizationId" nullable
-- (NULL = global) and the unique key on COALESCE("organizationId", zero-uuid).
-- The code upserts with onConflict on the plain columns, which Postgres can't
-- match to an expression index ("no unique or exclusion constraint matching
-- the ON CONFLICT specification"), so neither the daily sync nor a manual
-- override has ever saved a rate there. 20261003_01's design: the all-zero
-- UUID is the global scope, the column is NOT NULL, and the unique index is on
-- the plain columns. Safe to re-run.

BEGIN;

-- The global sentinel isn't a real organization, so a foreign key on
-- "organizationId" (20261003_01 has none) would refuse every global row.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = '"ExchangeRate"'::regclass AND con.contype = 'f' AND att.attname = 'organizationId'
  LOOP
    EXECUTE format('ALTER TABLE "ExchangeRate" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

UPDATE "ExchangeRate" SET "organizationId" = '00000000-0000-0000-0000-000000000000' WHERE "organizationId" IS NULL;

ALTER TABLE "ExchangeRate"
  ALTER COLUMN "organizationId" SET DEFAULT '00000000-0000-0000-0000-000000000000',
  ALTER COLUMN "organizationId" SET NOT NULL;

DROP INDEX IF EXISTS "ExchangeRate_scope_pair_date_key";
CREATE UNIQUE INDEX "ExchangeRate_scope_pair_date_key"
  ON "ExchangeRate" ("organizationId", "baseCurrency", "targetCurrency", "rateDate");

COMMIT;
