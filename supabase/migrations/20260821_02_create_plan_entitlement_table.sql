-- Entitlement system: migration 2 of 5.
-- EAV-style table: one row per (plan, feature-or-limit code). Booleans use
-- `enabled`, quantitative limits use `limitValue` (NULL = unlimited). A
-- feature code row typically has limitValue NULL and enabled true/false; a
-- limit code row has enabled irrelevant (always true) and limitValue set.
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "PlanEntitlement" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planId"     uuid NOT NULL REFERENCES "PlatformPlan"(id) ON DELETE CASCADE,
  code         text NOT NULL,
  "limitValue" integer,
  enabled      boolean NOT NULL DEFAULT true,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_entitlement_unique UNIQUE ("planId", code)
);

CREATE INDEX IF NOT EXISTS plan_entitlement_plan_id_idx ON "PlanEntitlement" ("planId");
CREATE INDEX IF NOT EXISTS plan_entitlement_code_idx ON "PlanEntitlement" (code);
