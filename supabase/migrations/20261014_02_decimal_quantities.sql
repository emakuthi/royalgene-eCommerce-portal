-- Decimal quantities: lets a product sold by weight or volume (kg, g, litre,
-- ml, metre) carry fractional stock and sales, e.g. 0.5 kg of rice.
-- Run manually in the Supabase SQL Editor, AFTER 20261014_01. Safe to re-run.
--
-- integer -> numeric(14,3) keeps every existing value (5 becomes 5.000) and
-- rounds to grams/millilitres, so float noise (0.1 + 0.2) never lands. The
-- server only accepts fractions for measured units (see isMeasuredUnit in
-- src/lib/business-types.ts), so app builds that still read quantities as
-- whole numbers keep working for every piece-counted product.
--
-- The ShopStockVariant -> ShopStock rollup trigger just SUMs, so it needs no
-- change. If an ALTER below fails with "cannot alter type of a column used by
-- a view or rule", tell the developer which view it names.

ALTER TABLE "ShopStock"        ALTER COLUMN "quantity"          TYPE numeric(14,3) USING "quantity"::numeric;
ALTER TABLE "ShopStock"        ALTER COLUMN "lowStockThreshold" TYPE numeric(14,3) USING "lowStockThreshold"::numeric;
ALTER TABLE "ShopStockVariant" ALTER COLUMN "quantity"          TYPE numeric(14,3) USING "quantity"::numeric;
ALTER TABLE "SalesEntry"       ALTER COLUMN "quantity"          TYPE numeric(14,3) USING "quantity"::numeric;
ALTER TABLE "StockTransaction" ALTER COLUMN "quantity"          TYPE numeric(14,3) USING "quantity"::numeric;
ALTER TABLE "StockTransfer"    ALTER COLUMN "quantity"          TYPE numeric(14,3) USING "quantity"::numeric;
ALTER TABLE "Product"          ALTER COLUMN "stockQuantity"     TYPE numeric(14,3) USING "stockQuantity"::numeric;
