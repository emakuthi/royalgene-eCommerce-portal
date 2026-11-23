-- Purchase receipts, kept in the workspace owner's Google Drive.
--
-- The image/PDF itself lives only in Drive (a "RoyalTrack Receipts" folder
-- the owner connects from Settings -> Integrations); a Receipt row is just
-- the pointer plus what was read off it, linked to the expense or stock
-- purchase it backs. Drive access is a TenantOAuthConnection row with
-- provider 'google_drive' (refresh token encrypted, like QuickBooks).
--
-- Idempotent.

-- The Google account a connection belongs to, shown in Settings.
ALTER TABLE "TenantOAuthConnection" ADD COLUMN IF NOT EXISTS "externalAccountLabel" text;

CREATE TABLE IF NOT EXISTS "Receipt" (
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

CREATE INDEX IF NOT EXISTS "Receipt_org_date_idx" ON "Receipt" ("organizationId", "receiptDate" DESC, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Receipt_expense_idx" ON "Receipt" ("expenseId") WHERE "expenseId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Receipt_stock_txn_idx" ON "Receipt" ("stockTransactionId") WHERE "stockTransactionId" IS NOT NULL;

-- Server-only table: the anon/authenticated roles never read it directly.
ALTER TABLE "Receipt" ENABLE ROW LEVEL SECURITY;
