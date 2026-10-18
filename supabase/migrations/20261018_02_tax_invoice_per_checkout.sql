-- One tax invoice per checkout.
--
-- A multi-item checkout is several SalesEntry rows sharing a saleGroupId
-- (Android checkouts, and the portal's multi-item cart). Each line still
-- arrives as its own request, so the invoice is built up as lines arrive:
-- the first line creates it, later lines are appended with
-- append_tax_invoice_line(), which does the append in one UPDATE so two
-- lines landing at the same moment can't overwrite each other.
--
--   saleGroupId    : the checkout this invoice covers (NULL = single-line sale)
--   salesEntryIds  : every SalesEntry on the invoice (salesEntryId stays the first)
--
-- Run manually in the Supabase SQL Editor. Idempotent. Existing invoices are
-- backfilled with salesEntryIds = {salesEntryId} and otherwise untouched.

ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "saleGroupId" uuid;
ALTER TABLE "TaxInvoice" ADD COLUMN IF NOT EXISTS "salesEntryIds" text[] NOT NULL DEFAULT '{}';

UPDATE "TaxInvoice"
SET "salesEntryIds" = ARRAY["salesEntryId"]
WHERE cardinality("salesEntryIds") = 0;

-- One invoice per checkout per organization.
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoice_org_sale_group_key
  ON "TaxInvoice" ("organizationId", "saleGroupId")
  WHERE "saleGroupId" IS NOT NULL;

-- Find the invoice a given line belongs to (sale deletion guard, lookups).
CREATE INDEX IF NOT EXISTS tax_invoice_sales_entry_ids_idx
  ON "TaxInvoice" USING gin ("salesEntryIds");

-- Append one line to a checkout's invoice. Returns false when the line is
-- already on it (a retried request), so callers can treat that as done.
CREATE OR REPLACE FUNCTION append_tax_invoice_line(
  p_invoice_id     uuid,
  p_sales_entry_id text,
  p_item           jsonb,
  p_taxable        integer,
  p_tax            integer,
  p_total          integer
) RETURNS boolean
LANGUAGE sql
AS $$
  WITH appended AS (
    UPDATE "TaxInvoice"
    SET "itemsJson"          = "itemsJson" || jsonb_build_array(p_item),
        "salesEntryIds"      = array_append("salesEntryIds", p_sales_entry_id),
        "totalTaxableAmount" = "totalTaxableAmount" + p_taxable,
        "totalTaxAmount"     = "totalTaxAmount" + p_tax,
        "totalAmount"        = "totalAmount" + p_total
    WHERE id = p_invoice_id
      AND NOT (p_sales_entry_id = ANY ("salesEntryIds"))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM appended);
$$;

-- Same deny-by-default posture as the tables: only the service_role API may call it.
REVOKE ALL ON FUNCTION append_tax_invoice_line(uuid, text, jsonb, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_tax_invoice_line(uuid, text, jsonb, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION append_tax_invoice_line(uuid, text, jsonb, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION append_tax_invoice_line(uuid, text, jsonb, integer, integer, integer) TO service_role;
