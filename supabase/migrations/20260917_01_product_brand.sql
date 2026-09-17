-- Product.brand — both the portal's "Add Product" form and the Android
-- app's create/edit product form have always had a Brand input, but nothing
-- ever persisted it: the Product table had no column for it, so it was
-- silently dropped at every layer (portal frontend never even included it
-- in the request; the shared createProductForShop() helper and every
-- update-field whitelist dropped it too). Confirmed live 2026-09-17 —
-- Product had never had a brand column at all.
--
-- Nullable/no default: every existing product simply has no brand recorded,
-- same as if this had always existed.
--
-- Idempotent.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brand" text;
