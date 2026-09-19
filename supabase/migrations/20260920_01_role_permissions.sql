-- Per-organization role permission overrides. A row here flips one
-- capability for one role away from its hardcoded default (see
-- src/lib/permissions.server.ts) — an org that never touches the new
-- Permissions screen keeps running on defaults with zero rows.
--
-- "admin" (the workspace-owner account) and the "shop_owner" PortalUser
-- position are intentionally NOT rows in this table — they always have
-- every capability, hardcoded, so an admin can never lock themselves out
-- by misconfiguring their own row.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "RolePermission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "permission" text NOT NULL,
  "enabled" boolean NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", "role", "permission")
);

CREATE INDEX IF NOT EXISTS "RolePermission_organizationId_idx" ON "RolePermission" ("organizationId");

-- Same RLS posture as every other table since 20260910_04: deny-all for the
-- anon/authenticated roles, service-role (used by every API route here)
-- bypasses RLS entirely.
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
