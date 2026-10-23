-- SKUs are unique per SHOP, not across the whole platform.
--
-- The old single-column UNIQUE("sku") (Product_sku_key) dates from before
-- multi-tenancy: one business couldn't use an SKU another business already
-- had, two shops of the same business couldn't each have their own product
-- with the same SKU, and because "no SKU" is stored as '' (the column is
-- NOT NULL), only ONE product on the entire platform could have no SKU.
--
-- Products are business-wide and stocked per shop (ShopStock), so "unique
-- per shop" can't be a Product index. It's enforced in the API
-- (src/lib/product-sku.server.ts) on create/edit, and transfers add into
-- the receiving shop's same-SKU product instead of listing a second one.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Product_sku_key";

-- Plain (non-unique) index for the SKU lookups those checks and scans do.
CREATE INDEX IF NOT EXISTS "Product_organizationId_sku_idx"
  ON "Product" ("organizationId", "sku")
  WHERE "sku" <> '';
