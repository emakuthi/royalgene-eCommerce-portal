-- Multi-tenancy: Phase 1, migration 1 of 7
-- Creates the Organization table. Every tenant-scoped table gets an
-- organizationId/organization_id FK to this table in migration 3.
--
-- Review before running: this repo has no prior .sql migration history, so
-- please confirm this doesn't collide with any object you already have.

CREATE TABLE IF NOT EXISTS "Organization" (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  slug                      text NOT NULL,
  status                    text NOT NULL DEFAULT 'pending_verification'
                                 CHECK (status IN ('pending_verification', 'active', 'suspended', 'cancelled')),
  "planTier"                text NOT NULL DEFAULT 'free'
                                 CHECK ("planTier" IN ('free', 'starter', 'pro', 'enterprise', 'legacy')),
  "paystackCustomerCode"    text,
  "paystackSubscriptionCode" text,
  "paystackPlanCode"        text,
  "billingEmail"            text,
  "billingStatus"           text,
  "trialEndsAt"             timestamptz,
  "logoUrl"                 text,
  tagline                   text DEFAULT 'Management Portal',
  "themeSettings"           jsonb,
  "customDomain"            text,
  "createdBy"               uuid, -- intentionally no FK: avoids a chicken/egg with User.organizationId
  "createdAt"               timestamptz NOT NULL DEFAULT now(),
  "updatedAt"               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_slug_unique UNIQUE (slug),
  CONSTRAINT organization_custom_domain_unique UNIQUE ("customDomain")
);

CREATE INDEX IF NOT EXISTS organization_slug_idx ON "Organization" (slug);
CREATE INDEX IF NOT EXISTS organization_status_idx ON "Organization" (status);
