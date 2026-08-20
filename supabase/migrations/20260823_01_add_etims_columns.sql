-- eTIMS: migration 1 of 4.
-- kraPin is a tenant's KRA PIN (like a tax ID printed on every invoice —
-- not a secret, stored plaintext, same sensitivity class as
-- businessShortCode in the M-Pesa work). taxType classifies a product for
-- VAT purposes per KRA's documented codes; 'B' (16% standard rate) is the
-- default so existing products don't need manual reclassification.
--
-- Run manually via the Supabase SQL Editor.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "kraPin" text;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "taxType" text NOT NULL DEFAULT 'B';
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_taxType_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxType_check" CHECK ("taxType" IN ('A', 'B', 'C', 'D'));
