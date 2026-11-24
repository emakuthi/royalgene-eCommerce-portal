-- Archive a product that can't be restocked for now (not available in the
-- market): it leaves the stock lists, sale pickers and low-stock counts but
-- keeps its history, and the owner can bring it back any time. Unlike a
-- delete, nothing else changes.
--
-- Restocking brings it back on its own: any shop's stock going above zero
-- clears "archivedAt", whichever route added the stock (restock, transfer,
-- adjustment, a returned sale).

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "archivedBy" text;

CREATE OR REPLACE FUNCTION unarchive_product_on_restock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity > 0 AND NEW."deletedAt" IS NULL THEN
    UPDATE "Product" SET "archivedAt" = NULL, "archivedBy" = NULL
     WHERE id = NEW."productId" AND "archivedAt" IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS unarchive_product_on_restock ON "ShopStock";
CREATE TRIGGER unarchive_product_on_restock
  AFTER INSERT OR UPDATE OF quantity, "deletedAt" ON "ShopStock"
  FOR EACH ROW EXECUTE FUNCTION unarchive_product_on_restock();
