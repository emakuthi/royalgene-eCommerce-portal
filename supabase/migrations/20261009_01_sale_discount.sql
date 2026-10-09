-- Persist sale discounts. Until now the Android app showed a checkout
-- discount on screen but never sent it — every sale was recorded at full
-- price — and the portal form folded it into a lowered unitPrice, so the
-- discount itself was never recorded anywhere. Run manually in the Supabase
-- SQL Editor. Backward compatible — existing sales get 0.
--
--   discountAmount : this line item's share of the checkout discount, in the
--                    sale currency. totalAmount is NET of it
--                    (quantity * unitPrice - discountAmount), so revenue and
--                    profit (via baseAmount) already reflect what was paid.

ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "discountAmount" numeric NOT NULL DEFAULT 0;
