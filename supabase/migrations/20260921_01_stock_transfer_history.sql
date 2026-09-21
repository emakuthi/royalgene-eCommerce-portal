-- Stock transfer HISTORY — the transfer list screen on mobile.
--
-- Until now only the two-party "request" flow wrote a StockTransfer row; the
-- instant transfer (POST .../stock/transfer) left just two StockTransaction
-- audit legs, with no single record saying who moved what to where. From now
-- on the instant transfer also writes a StockTransfer row (status
-- 'confirmed', kind 'instant') so every transfer, of either kind, is one row
-- that can be listed and opened.
--
--   kind      'request' (two-party handoff, the original meaning of this
--             table) | 'instant' (moved in one call, no second party).
--   variants  For a product tracked by size/colour: the cells that moved,
--             [{ "size": "M", "color": "Blue", "quantity": 2 }, ...].
--             NULL for a plain quantity transfer. `quantity` stays the total.
--
-- Idempotent.

ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'request'
    CHECK ("kind" IN ('request', 'instant'));

ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "variants" jsonb;

CREATE INDEX IF NOT EXISTS stock_transfer_org_initiated_idx
  ON "StockTransfer" ("organizationId", "initiatedAt" DESC);
