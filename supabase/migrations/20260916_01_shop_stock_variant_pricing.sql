-- Per-cell pricing on the size × colour matrix. Some products sell at a
-- different price and cost per size (or size+colour) — the product-level
-- price/costPrice on "Product" stays the DEFAULT for a cell that doesn't
-- override it (both columns nullable: null means "use the product's own
-- price"), so every product created before this migration keeps working
-- unchanged with zero variant-level pricing.
--
-- Idempotent.

ALTER TABLE "ShopStockVariant" ADD COLUMN IF NOT EXISTS "price" numeric;
ALTER TABLE "ShopStockVariant" ADD COLUMN IF NOT EXISTS "costPrice" numeric;
