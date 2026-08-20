-- eTIMS: migration 2 of 4.
-- One row per SalesEntry, generated (not submitted to KRA — see
-- src/lib/etims/tax-invoice.server.ts). itemsJson holds the KRA-format line
-- items so the invoice can be re-rendered/printed without re-deriving from
-- SalesEntry/Product later (product prices can change after the sale).
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "TaxInvoice" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"       uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "salesEntryId"         text NOT NULL, -- SalesEntry.id is a legacy text PK, not uuid
  "invoiceNumber"        text NOT NULL,
  "kraPin"               text NOT NULL,
  "itemsJson"            jsonb NOT NULL,
  "totalTaxableAmount"   integer NOT NULL, -- cents
  "totalTaxAmount"       integer NOT NULL, -- cents
  "totalAmount"          integer NOT NULL, -- cents
  "qrCodeData"           text NOT NULL,
  status                 text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated')), -- only value until live KRA submission ever gets built
  "createdAt"            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_invoice_sales_entry_unique UNIQUE ("salesEntryId")
);

CREATE INDEX IF NOT EXISTS tax_invoice_organization_id_idx ON "TaxInvoice" ("organizationId");
