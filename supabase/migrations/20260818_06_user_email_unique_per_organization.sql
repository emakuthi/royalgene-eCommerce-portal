-- Multi-tenancy: Phase 1, migration 6 of 7
-- Moves User.email from globally-unique to unique-per-organization, so the
-- same email can sign up independently at two different tenants as two
-- separate User rows (each org's signup is an independent identity space).
--
-- IMPORTANT: the existing unique constraint's real name is unknown from this
-- repo (no prior migration history). Find it first:
--   SELECT conname FROM pg_constraint WHERE conrelid = '"User"'::regclass AND contype = 'u';
-- then replace User_email_key below with the actual name before running.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";

-- Case-insensitive + org-scoped. Two indexes because a single multi-column
-- unique index treats NULL organizationId values as all-distinct, which
-- would silently allow duplicate super_admin emails otherwise.
CREATE UNIQUE INDEX IF NOT EXISTS user_email_org_unique
  ON "User" (lower(email), "organizationId")
  WHERE "organizationId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_email_platform_unique
  ON "User" (lower(email))
  WHERE "organizationId" IS NULL;

-- Audit and repeat this pattern for any other live global-uniqueness
-- constraints you find before shipping self-serve signup broadly, e.g.:
--   Product.sku, Invoice.invoiceNumber, Receipt.receiptNumber, Order.orderNumber
-- None of these are verifiable from this repo (no SQL history) — check the
-- live schema via `\d "Product"` etc. in the Supabase SQL editor.
