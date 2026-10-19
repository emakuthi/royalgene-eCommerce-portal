-- M-Pesa STK push for shop sales.
-- Run manually in the Supabase SQL Editor. Safe to re-run.
--
-- One row per payment prompt sent to a customer's phone from a shop's till.
-- The money goes to the workspace's own Paybill/Till (its Daraja keys live in
-- TenantIntegrationConfig). Safaricom reports the result to
-- /api/webhooks/mpesa/<callbackToken>; the app polls the row until it is
-- settled, then saves the sale with the M-Pesa receipt number.

CREATE TABLE IF NOT EXISTS "MpesaPayment" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "shopId"            text,
  "requestedBy"       text,
  phone               text NOT NULL,                       -- 2547XXXXXXXX / 2541XXXXXXXX
  amount              integer NOT NULL CHECK (amount > 0), -- whole KES, as M-Pesa charges it
  "callbackToken"     text NOT NULL,
  "checkoutRequestId" text UNIQUE,
  "merchantRequestId" text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  "resultCode"        integer,
  "resultDesc"        text,
  "mpesaReceipt"      text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "MpesaPayment_org_created_idx" ON "MpesaPayment" ("organizationId", "createdAt" DESC);

-- Reached only through the service role, like every other table here.
ALTER TABLE "MpesaPayment" ENABLE ROW LEVEL SECURITY;
