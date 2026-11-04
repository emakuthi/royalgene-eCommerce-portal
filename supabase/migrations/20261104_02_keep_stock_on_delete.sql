-- Deleting stock must never lose it.
--
-- Removing a ShopStock row cascades to its size/colour cells and to every
-- StockTransaction, and deleting a product removes its ShopStock rows, so one
-- delete erased a product's count and whole history for good. This keeps a copy
-- of all three, taken by the database itself so that no route can skip it, and
-- restore_deleted_product puts them back with their original ids. Keeping the
-- ids means a phone still holding the old row updates it instead of gaining a
-- second row for the same product.
--
-- Safe to run before the code that uses it deploys: the trigger works alone.
-- Products deleted before this runs have nothing saved and can't be restored here.

CREATE TABLE IF NOT EXISTS "DeletedShopStock" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "shopStockId"   text NOT NULL,
  "productId"     text NOT NULL,
  "shopId"        text NOT NULL,
  stock           jsonb NOT NULL,
  variants        jsonb NOT NULL DEFAULT '[]'::jsonb,
  transactions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "deletedAt"     timestamptz NOT NULL DEFAULT now(),
  "restoredAt"    timestamptz
);

CREATE INDEX IF NOT EXISTS "DeletedShopStock_org_product_idx"
  ON "DeletedShopStock" ("organizationId", "productId");

-- Only the server's service role reaches this table.
ALTER TABLE "DeletedShopStock" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION keep_deleted_shop_stock() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A purged workspace cascades here after its Organization row is gone. Its
  -- data is meant to go, and there's no longer an organization to keep it under.
  IF NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = OLD."organizationId") THEN
    RETURN OLD;
  END IF;

  INSERT INTO "DeletedShopStock"
    ("organizationId", "shopStockId", "productId", "shopId", stock, variants, transactions)
  VALUES (
    OLD."organizationId", OLD.id, OLD."productId", OLD."shopId", to_jsonb(OLD),
    COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM "ShopStockVariant" v WHERE v."shopStockId" = OLD.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM "StockTransaction" t WHERE t."shopStockId" = OLD.id), '[]'::jsonb)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS keep_deleted_shop_stock ON "ShopStock";
CREATE TRIGGER keep_deleted_shop_stock
  BEFORE DELETE ON "ShopStock"
  FOR EACH ROW EXECUTE FUNCTION keep_deleted_shop_stock();

-- Brings a product and its saved stock back, all or nothing. A shop is skipped,
-- with the reason reported, when it's gone, already stocks the product, or has
-- another product using the same SKU. Rows get a new updatedAt so phones pull them.
CREATE OR REPLACE FUNCTION restore_deleted_product(p_organization_id uuid, p_product_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sku text;
  v_saved "DeletedShopStock"%ROWTYPE;
  v_restored jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
  v_now timestamptz := now();
BEGIN
  SELECT sku INTO v_sku FROM "Product"
  WHERE id = p_product_id AND "organizationId" = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  -- The newest copy for each shop is the state the person last saw there.
  FOR v_saved IN
    SELECT DISTINCT ON (d."shopId") d.*
    FROM "DeletedShopStock" d
    WHERE d."organizationId" = p_organization_id
      AND d."productId" = p_product_id
      AND d."restoredAt" IS NULL
    ORDER BY d."shopId", d."deletedAt" DESC
  LOOP
    v_reason := NULL;
    IF NOT EXISTS (SELECT 1 FROM "Shop" s WHERE s.id = v_saved."shopId" AND s."deletedAt" IS NULL) THEN
      v_reason := 'SHOP_GONE';
    ELSIF EXISTS (SELECT 1 FROM "ShopStock" ss WHERE ss."shopId" = v_saved."shopId" AND ss."productId" = p_product_id) THEN
      v_reason := 'ALREADY_STOCKED';
    ELSIF EXISTS (
      SELECT 1 FROM "ShopStock" ss
      JOIN "Product" o ON o.id = ss."productId"
      WHERE ss."shopId" = v_saved."shopId"
        AND o.id <> p_product_id
        AND o."deletedAt" IS NULL
        AND lower(btrim(o.sku)) = lower(btrim(v_sku))
    ) THEN
      v_reason := 'SKU_TAKEN';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('shopId', v_saved."shopId", 'reason', v_reason);
      CONTINUE;
    END IF;

    INSERT INTO "ShopStock"
    SELECT (jsonb_populate_record(NULL::"ShopStock",
      v_saved.stock || jsonb_build_object('updatedAt', v_now, 'deletedAt', NULL))).*;

    INSERT INTO "ShopStockVariant"
    SELECT (jsonb_populate_record(NULL::"ShopStockVariant",
      v.row || jsonb_build_object('updatedAt', v_now, 'deletedAt', NULL))).*
    FROM jsonb_array_elements(v_saved.variants) AS v(row);

    INSERT INTO "StockTransaction"
    SELECT (jsonb_populate_record(NULL::"StockTransaction",
      t.row || jsonb_build_object('updatedAt', v_now))).*
    FROM jsonb_array_elements(v_saved.transactions) AS t(row);

    UPDATE "DeletedShopStock" SET "restoredAt" = v_now
    WHERE "organizationId" = p_organization_id
      AND "productId" = p_product_id
      AND "shopId" = v_saved."shopId"
      AND "restoredAt" IS NULL;

    v_restored := v_restored || to_jsonb(v_saved."shopId");
  END LOOP;

  -- A product with no shops would be invisible, so don't un-delete it into that.
  IF jsonb_array_length(v_restored) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTHING_TO_RESTORE', 'skipped', v_skipped);
  END IF;

  UPDATE "Product" p SET
    "deletedAt" = NULL,
    "stockQuantity" = (SELECT COALESCE(SUM(ss.quantity), 0) FROM "ShopStock" ss WHERE ss."productId" = p.id)
  WHERE p.id = p_product_id;

  RETURN jsonb_build_object('ok', true, 'restored', v_restored, 'skipped', v_skipped);
END;
$$;

-- Functions are callable by anyone by default, and Supabase exposes them over its API.
REVOKE ALL ON FUNCTION restore_deleted_product(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION restore_deleted_product(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION keep_deleted_shop_stock() FROM PUBLIC, anon, authenticated;
