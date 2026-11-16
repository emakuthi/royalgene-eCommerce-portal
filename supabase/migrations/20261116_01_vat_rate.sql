-- VAT on receipts: the workspace's VAT rate in percent (e.g. 16), or NULL when
-- the business doesn't charge VAT. Prices are VAT-inclusive, so the rate only
-- splits out the VAT share on receipts; it never changes a sale's total.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,2);

ALTER TABLE "Organization" DROP CONSTRAINT IF EXISTS "Organization_vatRate_range";
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_vatRate_range"
  CHECK ("vatRate" IS NULL OR ("vatRate" > 0 AND "vatRate" < 100));
