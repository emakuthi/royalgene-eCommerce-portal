-- Size × colour matrix inventory.
--
-- A new level below ShopStock: one ShopStockVariant row per (shopStock,
-- size, colour) cell. The product total stays authoritative and rolls up
-- automatically:
--
--   ShopStockVariant.quantity  --(trigger)-->  ShopStock.quantity
--   ShopStock.quantity          --(app: syncProductStockFromShopStocks)-->  Product.stockQuantity
--
-- Row / column totals ("all M", "all Red") are computed on read, never
-- stored, so they cannot drift. Products with no breakdown keep working
-- exactly as before (flat ShopStock.quantity, zero variant rows).
--
-- SalesEntry / StockTransaction get nullable size/colour so every movement
-- is auditable at the cell level.
--
-- Idempotent.

-- ── ShopStockVariant ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ShopStockVariant" (
  "id"             text PRIMARY KEY,
  "shopStockId"    text NOT NULL REFERENCES "ShopStock"(id) ON DELETE CASCADE,
  "organizationId" uuid REFERENCES "Organization"(id) ON DELETE CASCADE,
  "size"           text NOT NULL DEFAULT '',
  "color"          text NOT NULL DEFAULT '',
  "quantity"       integer NOT NULL DEFAULT 0 CHECK ("quantity" >= 0),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_stock_variant_cell_uniq
  ON "ShopStockVariant" ("shopStockId", "size", "color");
CREATE INDEX IF NOT EXISTS shop_stock_variant_shopstock_idx
  ON "ShopStockVariant" ("shopStockId");
CREATE INDEX IF NOT EXISTS shop_stock_variant_org_idx
  ON "ShopStockVariant" ("organizationId");

-- ── Rollup trigger: ShopStock.quantity = SUM(variants) ───────────────────
CREATE OR REPLACE FUNCTION sync_shopstock_from_variants() RETURNS trigger AS $$
DECLARE
  target_ids text[];
  sid text;
BEGIN
  -- Collect every shopStockId touched by this row change (usually one).
  target_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."shopStockId" END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."shopStockId" END
    ]) AS x WHERE x IS NOT NULL
  );

  FOREACH sid IN ARRAY target_ids LOOP
    UPDATE "ShopStock" s
    SET "quantity" = COALESCE((
          SELECT SUM(v."quantity") FROM "ShopStockVariant" v WHERE v."shopStockId" = sid
        ), 0),
        "updatedAt" = now()
    WHERE s."id" = sid;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shop_stock_variant_rollup ON "ShopStockVariant";
CREATE TRIGGER shop_stock_variant_rollup
  AFTER INSERT OR UPDATE OR DELETE ON "ShopStockVariant"
  FOR EACH ROW EXECUTE FUNCTION sync_shopstock_from_variants();

-- ── Cell-level audit on movements ───────────────────────────────────────
ALTER TABLE "SalesEntry"        ADD COLUMN IF NOT EXISTS "size"  text;
ALTER TABLE "SalesEntry"        ADD COLUMN IF NOT EXISTS "color" text;
ALTER TABLE "StockTransaction"  ADD COLUMN IF NOT EXISTS "size"  text;
ALTER TABLE "StockTransaction"  ADD COLUMN IF NOT EXISTS "color" text;
