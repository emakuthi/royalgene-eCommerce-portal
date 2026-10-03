-- Phase 3 (minimal purchases): capture purchase cost + currency on restock
-- transactions. A "purchase" here = a positive stock movement (restock) with a
-- recorded cost. Maps onto the existing StockTransaction ledger rather than a
-- separate module. Run manually in the Supabase SQL Editor. Backward compatible
-- — all columns nullable/defaulted; existing transactions untouched.
--
--   currency     : the currency the purchase cost was entered in (default base)
--   exchangeRate : currency→base rate FROZEN at purchase time
--   unitCost     : cost per unit, in `currency`
--   baseAmount   : total purchase cost in base (= unitCost * added qty * rate)

ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "currency"     text;
ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "exchangeRate" numeric NOT NULL DEFAULT 1;
ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "unitCost"     numeric;
ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "baseAmount"   numeric;
