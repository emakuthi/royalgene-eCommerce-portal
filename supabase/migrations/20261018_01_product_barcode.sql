-- Barcode scanning support.
--
-- One ProductBarcode row per scannable code. A product can carry several codes
-- (supplier EAN, own printed label, pack vs single), and a code may optionally
-- point at one size/colour cell so a scan resolves to the exact variant sold or
-- received. size/colour are '' (not NULL) when the code covers the whole
-- product, matching ShopStockVariant's convention.
--
-- Codes are unique per organization (two tenants may legitimately use the same
-- code), compared case-insensitively on the trimmed value.
--
-- Run manually in the Supabase SQL Editor. Idempotent. Existing products are
-- untouched: no barcode rows means scanning falls back to SKU matching.

CREATE TABLE IF NOT EXISTS "ProductBarcode" (
  "id"             text PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "productId"      text NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  "code"           text NOT NULL CHECK (length(btrim("code")) > 0),
  "size"           text NOT NULL DEFAULT '',
  "color"          text NOT NULL DEFAULT '',
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- Scan lookups: (organization, code) must be unique and fast.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBarcode_org_code_key"
  ON "ProductBarcode" ("organizationId", lower(btrim("code")));

CREATE INDEX IF NOT EXISTS "ProductBarcode_product_idx"
  ON "ProductBarcode" ("productId");

-- Same deny-by-default posture as every other table (see
-- 20260910_04_enable_rls_deny_all.sql): only the service_role API can touch it.
ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ProductBarcode" FROM anon;
REVOKE ALL ON "ProductBarcode" FROM authenticated;
