-- Overage billing: migration 1 of 1.
--
-- "allowOverage": when true, assertCanCreate/assertStorageQuota let a tenant
-- exceed their plan's hard limit instead of blocking the operation — the
-- excess is billed via generateInvoice() at period-close rather than
-- enforced at the point of use. Deliberately NOT tracked via a separate
-- overage-event ledger: at invoice time, overage is computed the same way
-- every other limit's usage already is — a live comparison of current usage
-- against the plan limit, not a running counter.
--
-- Run manually via the Supabase SQL Editor.

ALTER TABLE "PlatformPlan" ADD COLUMN IF NOT EXISTS "allowOverage" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "PlanOverageRate" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planId"            uuid NOT NULL REFERENCES "PlatformPlan"(id) ON DELETE CASCADE,
  "limitCode"         text NOT NULL,
  unit                integer NOT NULL DEFAULT 1, -- e.g. 1 (per unit) or 1000 (per 1,000 transactions)
  "pricePerUnitKobo"  integer NOT NULL,
  currency            text NOT NULL DEFAULT 'KES',
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_overage_rate_unique UNIQUE ("planId", "limitCode")
);

CREATE TABLE IF NOT EXISTS "Invoice" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  period            text NOT NULL, -- 'YYYY-MM'
  "basePriceKobo"   integer NOT NULL,
  "overageKobo"     integer NOT NULL DEFAULT 0,
  "totalKobo"        integer NOT NULL,
  currency          text NOT NULL DEFAULT 'KES',
  breakdown         jsonb, -- InvoiceLineItem[] — see src/lib/billing/billing-provider.ts
  status            text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'void')),
  "paidAt"          timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_org_period_unique UNIQUE ("organizationId", period)
);

CREATE INDEX IF NOT EXISTS invoice_organization_id_idx ON "Invoice" ("organizationId");
CREATE INDEX IF NOT EXISTS plan_overage_rate_plan_id_idx ON "PlanOverageRate" ("planId");
