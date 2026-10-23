-- SKUs are unique per business, not across the whole platform.
--
-- The old single-column UNIQUE("sku") (Product_sku_key) dates from before
-- multi-tenancy: one business couldn't use an SKU another business already
-- had, and because "no SKU" is stored as '' (the column is NOT NULL), only
-- ONE product on the entire platform could be saved without an SKU.
--
-- The global constraint guarantees there are no duplicates today, so the new
-- index builds cleanly. Blank SKUs are excluded so any number can have none.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Product_sku_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Product_organizationId_sku_key"
  ON "Product" ("organizationId", "sku")
  WHERE "sku" <> '';
