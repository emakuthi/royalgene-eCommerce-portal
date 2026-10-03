-- Expenses Phase 1: operating-expense tracking (enables Net Profit = gross − expenses).
-- Run manually in the Supabase SQL Editor. New tables only — nothing existing is touched.
-- Expenses reuse the currency engine: an expense in any currency stores a frozen
-- rate + baseAmount (in the tenant base) so it aggregates alongside sales.

CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  name             text NOT NULL,
  "isActive"       boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
-- One category name per org (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseCategory_org_name_key" ON "ExpenseCategory" ("organizationId", lower(name));
CREATE INDEX IF NOT EXISTS "ExpenseCategory_org_idx" ON "ExpenseCategory" ("organizationId");

CREATE TABLE IF NOT EXISTS "Expense" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "shopId"         uuid,                 -- NULL = org-wide expense
  "categoryId"     uuid,
  amount           numeric NOT NULL CHECK (amount >= 0),  -- in `currency`
  currency         text NOT NULL DEFAULT 'KES',
  "exchangeRate"   numeric NOT NULL DEFAULT 1,            -- currency→base, frozen
  "baseAmount"     numeric NOT NULL DEFAULT 0,            -- amount in tenant base
  description      text,
  "expenseDate"    date NOT NULL DEFAULT CURRENT_DATE,
  "recordedBy"     text,
  "deletedAt"      timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Expense_org_date_idx" ON "Expense" ("organizationId", "expenseDate" DESC);
CREATE INDEX IF NOT EXISTS "Expense_shop_idx" ON "Expense" ("shopId");
CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense" ("categoryId");
