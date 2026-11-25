-- Archiving now covers every shop's copy of an item (products with the same
-- SKU in the business, since SKU is unique per shop). Restocking any copy
-- brings all of them back, so the other shops see it to restock too.
-- Replaces the function from 20261124_02; the trigger itself is unchanged.

CREATE OR REPLACE FUNCTION unarchive_product_on_restock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.quantity > 0 AND NEW."deletedAt" IS NULL THEN
    SELECT id, "organizationId", NULLIF(btrim(sku), '') AS sku
      INTO item FROM "Product" WHERE id = NEW."productId";
    IF FOUND THEN
      UPDATE "Product" SET "archivedAt" = NULL, "archivedBy" = NULL
       WHERE "archivedAt" IS NOT NULL
         AND (id = item.id
              OR (item.sku IS NOT NULL
                  AND "organizationId" = item."organizationId"
                  AND lower(btrim(sku)) = lower(item.sku)
                  AND "deletedAt" IS NULL));
    END IF;
  END IF;
  RETURN NEW;
END $$;
