-- Phase 3 (expenses): recurring expense templates. A template materialises a
-- real Expense row on its schedule (see src/lib/recurring-expenses.server.ts +
-- the daily /api/cron/generate-recurring-expenses cron). The frozen FX rate is
-- resolved at GENERATION time per materialised row (createExpense), never here.

CREATE TABLE IF NOT EXISTS "RecurringExpense" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "shopId"         uuid,                 -- null = org-wide
  "categoryId"     uuid,
  amount           numeric NOT NULL,
  currency         text NOT NULL DEFAULT 'KES',
  description      text,
  frequency        text NOT NULL DEFAULT 'monthly',  -- 'daily' | 'weekly' | 'monthly'
  "interval"       integer NOT NULL DEFAULT 1,        -- every N periods
  "nextRunDate"    date NOT NULL,
  "endDate"        date,                 -- null = no end
  "isActive"       boolean NOT NULL DEFAULT true,
  "lastGeneratedDate" date,
  "createdBy"      uuid,
  "deletedAt"      timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "RecurringExpense_org_idx"
  ON "RecurringExpense" ("organizationId") WHERE "deletedAt" IS NULL;

-- The cron scans for due templates across all tenants.
CREATE INDEX IF NOT EXISTS "RecurringExpense_due_idx"
  ON "RecurringExpense" ("nextRunDate")
  WHERE "isActive" AND "deletedAt" IS NULL;
