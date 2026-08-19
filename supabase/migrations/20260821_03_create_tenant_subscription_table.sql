-- Entitlement system: migration 3 of 5.
-- The authoritative billing-cycle record for a tenant, distinct from
-- Organization.status (account lifecycle). One row per organization.
-- Organization.planTier/billingStatus/trialEndsAt remain as denormalized
-- copies kept in sync by subscription-status.server.ts, so middleware.ts
-- (edge runtime) never needs to read this table directly.
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "TenantSubscription" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"      uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "planId"              uuid REFERENCES "PlatformPlan"(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'trialing'
                             CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'expired')),
  "billingInterval"     text CHECK ("billingInterval" IN ('monthly', 'annually')),
  "currentPeriodStart"  timestamptz,
  "currentPeriodEnd"    timestamptz,
  "trialStart"          timestamptz,
  "trialEnd"            timestamptz,
  "cancelledAt"         timestamptz,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_subscription_organization_unique UNIQUE ("organizationId")
);

CREATE INDEX IF NOT EXISTS tenant_subscription_organization_id_idx ON "TenantSubscription" ("organizationId");
CREATE INDEX IF NOT EXISTS tenant_subscription_status_idx ON "TenantSubscription" (status);
CREATE INDEX IF NOT EXISTS tenant_subscription_plan_id_idx ON "TenantSubscription" ("planId");
