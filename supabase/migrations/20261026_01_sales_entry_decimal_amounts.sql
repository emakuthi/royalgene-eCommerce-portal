-- SalesEntry money columns: integer -> numeric(14,2).
-- Run manually in the Supabase SQL Editor. Safe to re-run.
--
-- unitPrice/totalAmount are major units (KES, not cents) and were still
-- integer from the original schema. Since decimal quantities (20261014_02)
-- and discounts, a total can carry cents — 1.5 kg × 2925 = 4387.5 — and the
-- insert failed with `invalid input syntax for type integer: "4387.5"`,
-- a 500 the app retries until it gives up and reverses the sale.
-- costPrice/baseAmount/exchangeRate/discountAmount were already numeric.
--
-- If an ALTER fails with "cannot alter type of a column used by a view or
-- rule", tell the developer which view it names.

ALTER TABLE "SalesEntry" ALTER COLUMN "unitPrice"   TYPE numeric(14,2) USING "unitPrice"::numeric;
ALTER TABLE "SalesEntry" ALTER COLUMN "totalAmount" TYPE numeric(14,2) USING "totalAmount"::numeric;

-- Check: both should now read "numeric".
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'SalesEntry' AND column_name IN ('unitPrice', 'totalAmount', 'quantity', 'costPrice', 'baseAmount', 'discountAmount');
