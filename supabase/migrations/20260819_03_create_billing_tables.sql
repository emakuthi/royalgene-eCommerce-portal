-- Paystack billing: plan catalog + webhook/audit log.
-- Run manually via the Supabase SQL Editor (direct psql can't reach this
-- project's DB over IPv6 — established in the multi-tenancy migrations).

CREATE TABLE IF NOT EXISTS "PlatformPlan" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier                      text NOT NULL UNIQUE, -- 'starter' | 'pro' | 'enterprise' (subset of Organization.planTier)
  name                      text NOT NULL,
  description               text,
  "monthlyPriceKobo"        integer NOT NULL, -- amount in the smallest currency unit
  "annualPriceKobo"         integer NOT NULL,
  currency                  text NOT NULL DEFAULT 'KES',
  "paystackMonthlyPlanCode" text,
  "paystackAnnualPlanCode"  text,
  "maxShops"                integer, -- null = unlimited (not enforced yet, reserved for a follow-up)
  "maxUsers"                integer,
  "isActive"                boolean NOT NULL DEFAULT true,
  "displayOrder"            integer NOT NULL DEFAULT 0,
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  "updatedAt"               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "BillingEvent" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL DEFAULT 'paystack',
  "eventType"      text NOT NULL,
  reference        text,
  "organizationId" uuid REFERENCES "Organization"(id) ON DELETE SET NULL,
  payload          jsonb,
  "processedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_event_reference_idx ON "BillingEvent" (reference);
