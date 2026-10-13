-- Basic restaurant mode: menu items made from ingredients.
-- Run manually in the Supabase SQL Editor, AFTER 20261014_02 (recipe amounts
-- are decimals). Safe to re-run.
--
-- Product.kind:
--   'stock' (default) — counted stock, sold from its own quantity, as before.
--   'menu'            — made to order: no stock of its own. Selling one uses
--                       up its recipe's ingredients at that shop instead.
--
-- RecipeItem: how much of each ingredient (another, stock-kind product of the
-- same workspace) goes into ONE of the menu item, in the ingredient's unit —
-- e.g. Burger = 1 Bun + 0.15 kg Beef + 1 Cheese slice.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'stock';
DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_kind_check" CHECK ("kind" IN ('stock', 'menu'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RecipeItem" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"       uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "productId"            text NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  "ingredientProductId"  text NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  quantity               numeric(14,3) NOT NULL CHECK (quantity > 0),
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  CHECK ("productId" <> "ingredientProductId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeItem_product_ingredient_key" ON "RecipeItem" ("productId", "ingredientProductId");
CREATE INDEX IF NOT EXISTS "RecipeItem_org_idx" ON "RecipeItem" ("organizationId");
CREATE INDEX IF NOT EXISTS "RecipeItem_ingredient_idx" ON "RecipeItem" ("ingredientProductId");

-- Reached only through the service role, like every other table here.
ALTER TABLE "RecipeItem" ENABLE ROW LEVEL SECURITY;
