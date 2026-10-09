-- Split payments: one checkout paid with more than one method (e.g. part
-- M-Pesa, part cash). Run manually in the Supabase SQL Editor. Backward
-- compatible — nullable; existing sales untouched.
--
--   paymentBreakdown : null for a single-method sale (paymentMethod says it
--                      all), else a JSON array of {"method","amount"} — the
--                      amounts the customer actually handed over, in the
--                      sale currency, for the WHOLE checkout. Every line item
--                      of the same saleGroupId carries the same array, so
--                      reports split a line's revenue by each method's share
--                      rather than summing the array per row.
--   paymentMethod    : still set, to the methods joined ("Cash + M-Pesa"), so
--                      anything that only reads this column stays readable.

ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "paymentBreakdown" jsonb;
