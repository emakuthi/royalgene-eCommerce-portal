-- Business types: lets a workspace be a boutique, hardware shop, pharmacy,
-- supermarket, restaurant or other business instead of only a boutique.
-- Run manually in the Supabase SQL Editor. Safe to re-run.
--
-- 1. Organization gets a business type and names for its two product options.
--    The options keep living in the existing size/color columns everywhere
--    (ShopStockVariant, SalesEntry, StockTransaction); only their labels
--    change. An empty label switches that option off.
-- 2. Product gets a unit (piece, kg, litre, pack ...).
-- 3. ProductCategory: each workspace's own editable categories. Product.category
--    stays a text column holding the category slug, so existing products need
--    no rewrite.
--
-- Every existing workspace was a boutique, so the defaults keep them exactly
-- as they are today.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "businessType" text NOT NULL DEFAULT 'boutique';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "option1Label" text NOT NULL DEFAULT 'Size';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "option2Label" text NOT NULL DEFAULT 'Colour';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unit" text NOT NULL DEFAULT 'piece';

CREATE TABLE IF NOT EXISTS "ProductCategory" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  slug             text NOT NULL,
  name             text NOT NULL,
  "sortOrder"      integer NOT NULL DEFAULT 0,
  "isActive"       boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_org_slug_key" ON "ProductCategory" ("organizationId", slug);
CREATE INDEX IF NOT EXISTS "ProductCategory_org_idx" ON "ProductCategory" ("organizationId");

-- Reached only through the service role, like every other table here.
ALTER TABLE "ProductCategory" ENABLE ROW LEVEL SECURITY;

-- Backfill: every existing workspace gets the four categories it has always had ...
INSERT INTO "ProductCategory" ("organizationId", slug, name, "sortOrder")
SELECT o.id, c.slug, c.name, c.ord
FROM "Organization" o
CROSS JOIN (VALUES ('dresses', 'Dresses', 1), ('shoes', 'Shoes', 2), ('trousers', 'Trousers', 3), ('textiles', 'Textiles', 4)) AS c(slug, name, ord)
ON CONFLICT ("organizationId", slug) DO NOTHING;

-- Products saved from the app carried free text ("Shoes", "accessories"); turn
-- every value into a slug the same way the server does (categorySlug in
-- src/lib/business-types.ts) ...
UPDATE "Product"
SET category = coalesce(nullif(trim(both '-' from regexp_replace(lower(replace(category, '&', ' and ')), '[^a-z0-9]+', '-', 'g')), ''), 'other')
WHERE category IS DISTINCT FROM coalesce(nullif(trim(both '-' from regexp_replace(lower(replace(category, '&', ' and ')), '[^a-z0-9]+', '-', 'g')), ''), 'other');

-- ... and give each workspace a category for every value its products carry.
INSERT INTO "ProductCategory" ("organizationId", slug, name, "sortOrder")
SELECT DISTINCT p."organizationId", p.category, initcap(replace(p.category, '-', ' ')), 50
FROM "Product" p
WHERE p."organizationId" IS NOT NULL
ON CONFLICT ("organizationId", slug) DO NOTHING;
