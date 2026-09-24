-- Per-tenant entitlement overrides — lets a super-admin set a quota for one
-- specific organization independent of its subscription plan's default
-- (negotiated deals, temporary bumps, etc). Same EAV shape as
-- `PlanEntitlement`, kept generic (any `code`) even though only limit codes
-- (STORAGE_GB, PRODUCTS, USERS) ship with UI initially, so a future
-- feature-toggle override needs no new migration.
--
-- `getLimit` (entitlement-service.server.ts) checks this table first, before
-- falling back to the tenant's plan. A present row always wins, even when
-- `limitValue` is NULL (explicit "unlimited" override).
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "OrgEntitlementOverride" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  code             text NOT NULL,
  "limitValue"     integer,
  enabled          boolean NOT NULL DEFAULT true,
  "createdBy"      uuid,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_entitlement_override_unique UNIQUE ("organizationId", code)
);

CREATE INDEX IF NOT EXISTS org_entitlement_override_org_id_idx ON "OrgEntitlementOverride" ("organizationId");
CREATE INDEX IF NOT EXISTS org_entitlement_override_code_idx ON "OrgEntitlementOverride" (code);

ALTER TABLE "OrgEntitlementOverride" ENABLE ROW LEVEL SECURITY;
