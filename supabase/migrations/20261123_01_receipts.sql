-- Purchase receipts, kept in the workspace owner's Google Drive.
--
-- The image/PDF itself lives only in Drive (a "RoyalTrack Receipts" folder
-- the owner connects from Settings -> Integrations); a PurchaseReceipt row is just
-- the pointer plus what was read off it, linked to the expense or stock
-- purchase it backs. Drive access is a TenantOAuthConnection row with
-- provider 'google_drive' (refresh token encrypted, like QuickBooks).
--
-- Named PurchaseReceipt because an unrelated legacy "Receipt" table (the old
-- eCommerce payment receipts: user_id, payment_date) already exists in prod.
--
-- Idempotent.

-- The Google account a connection belongs to, shown in Settings.
ALTER TABLE "TenantOAuthConnection" ADD COLUMN IF NOT EXISTS "externalAccountLabel" text;

CREATE TABLE IF NOT EXISTS "PurchaseReceipt" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "shopId"             text,                 -- NULL = not tied to one shop
  "expenseId"          uuid REFERENCES "Expense"(id) ON DELETE SET NULL,
  "stockTransactionId" text,                 -- the restock it backs (no FK: append-only ledger)
  "driveFileId"        text NOT NULL,
  "fileName"           text NOT NULL,
  "mimeType"           text NOT NULL,
  "sizeBytes"          integer NOT NULL DEFAULT 0,
  "supplier"           text,
  "amount"             numeric(14, 2),       -- major units, like Expense.amount
  "currency"           text,
  "receiptDate"        date,
  "notes"              text,
  "uploadedBy"         text,                 -- User.id
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now(),
  "deletedAt"          timestamptz
);

CREATE INDEX IF NOT EXISTS "PurchaseReceipt_org_date_idx" ON "PurchaseReceipt" ("organizationId", "receiptDate" DESC, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PurchaseReceipt_expense_idx" ON "PurchaseReceipt" ("expenseId") WHERE "expenseId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "PurchaseReceipt_stock_txn_idx" ON "PurchaseReceipt" ("stockTransactionId") WHERE "stockTransactionId" IS NOT NULL;

-- Server-only table: the anon/authenticated roles never read it directly.
ALTER TABLE "PurchaseReceipt" ENABLE ROW LEVEL SECURITY;

-- Make the API see the new table straight away.
NOTIFY pgrst, 'reload schema';
