-- Credit sales (deni): a sale paid fully or partly on credit names the
-- customer who owes it, and repayments are recorded against that customer.
-- Run manually on the VPS database. Safe to re-run.
--
-- A customer's balance is never stored: it is the credit part of their
-- live (not deleted) sales minus their live payments, so deleting or
-- editing a sale corrects it with no bookkeeping. See src/lib/credit.ts.
--
-- Both tables sync to phones (pull feed + client-generated ids), so they
-- carry deletedAt/version/updatedAt and the sync_touch trigger, like the
-- other synced tables (20260910_05).

CREATE TABLE IF NOT EXISTS "Customer" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  name             text NOT NULL,
  phone            text,                  -- as typed; not unique, two people can share a line
  notes            text,
  "createdBy"      text,                  -- PortalUser id
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz,
  version          bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS customer_org_updated_idx ON "Customer" ("organizationId", "updatedAt");

CREATE TABLE IF NOT EXISTS "CustomerPayment" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "customerId"     uuid NOT NULL REFERENCES "Customer"(id) ON DELETE CASCADE,
  "shopId"         text NOT NULL,         -- the shop that received it; scopes it like a sale
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),   -- tenant base currency
  method           text NOT NULL DEFAULT 'cash',               -- cash / M-Pesa / card
  note             text,
  "receivedBy"     text,                  -- PortalUser id
  "receivedAt"     timestamptz NOT NULL DEFAULT now(),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz,
  version          bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS customerpayment_org_updated_idx ON "CustomerPayment" ("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS customerpayment_customer_idx ON "CustomerPayment" ("customerId");

ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "customerId" uuid REFERENCES "Customer"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS salesentry_customer_idx ON "SalesEntry" ("customerId") WHERE "customerId" IS NOT NULL;

DROP TRIGGER IF EXISTS sync_touch ON "Customer";
CREATE TRIGGER sync_touch BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION sync_touch_row();
DROP TRIGGER IF EXISTS sync_touch ON "CustomerPayment";
CREATE TRIGGER sync_touch BEFORE UPDATE ON "CustomerPayment" FOR EACH ROW EXECUTE FUNCTION sync_touch_row();

-- Reached only through the service role, like every other table here.
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPayment" ENABLE ROW LEVEL SECURITY;

-- Verify:
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('Customer','CustomerPayment');
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'SalesEntry' AND column_name = 'customerId';
