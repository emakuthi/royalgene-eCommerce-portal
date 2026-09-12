-- Stock transfer REQUESTS — a two-party handoff, distinct from the existing
-- instant transfer already shipped at
-- POST /api/mobile/shops/[shopId]/stock/transfer (which moves stock
-- atomically in one call, no second party involved — left completely
-- unchanged, this is an ADDITIVE feature, not a replacement).
--
-- Stock moves in two stages to match physical reality:
--   1. INITIATE — the source shop's quantity decrements immediately (the
--      goods have left that shelf) and a 'pending' row is created here.
--   2. CONFIRM (by the destination shop) — the destination's quantity
--      increments (the goods have arrived) and StockTransaction audit rows
--      are written for both legs, same as the existing instant transfer's
--      convention.
--   ...or REJECT (by the destination shop) / CANCEL (by the source shop,
--   only while still pending) — the reserved quantity goes back to the
--   source shop, no StockTransaction rows (nothing net moved).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "StockTransfer" (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"           uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "productId"                text NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  "fromShopId"                text NOT NULL REFERENCES "Shop"(id) ON DELETE CASCADE,
  "toShopId"                  text NOT NULL REFERENCES "Shop"(id) ON DELETE CASCADE,
  quantity                   integer NOT NULL CHECK (quantity > 0),
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  notes                      text,
  "initiatedByPortalUserId"  text NOT NULL REFERENCES "PortalUser"(id) ON DELETE RESTRICT,
  "initiatedAt"              timestamptz NOT NULL DEFAULT now(),
  -- Set when status leaves 'pending' — by whoever confirmed/rejected/cancelled it.
  "resolvedByPortalUserId"   text REFERENCES "PortalUser"(id) ON DELETE SET NULL,
  "resolvedAt"               timestamptz,
  "rejectionReason"          text,
  "createdAt"                timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_transfer_org_idx ON "StockTransfer" ("organizationId");
CREATE INDEX IF NOT EXISTS stock_transfer_from_shop_idx ON "StockTransfer" ("fromShopId", status);
CREATE INDEX IF NOT EXISTS stock_transfer_to_shop_idx ON "StockTransfer" ("toShopId", status);

CREATE OR REPLACE FUNCTION stock_transfer_touch() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_transfer_touch ON "StockTransfer";
CREATE TRIGGER stock_transfer_touch BEFORE UPDATE ON "StockTransfer"
  FOR EACH ROW EXECUTE FUNCTION stock_transfer_touch();

-- Deny-all RLS, same as every table since Phase 0 — see
-- 20260912_01_device_registry.sql's comment for why this is still needed
-- even though ALTER DEFAULT PRIVILEGES already covers grants.
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StockTransfer" FROM anon;
REVOKE ALL ON "StockTransfer" FROM authenticated;
