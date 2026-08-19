-- Multi-tenancy: Phase 1, migration 2 of 7
-- Creates the "tenant #1" row that all existing RoyalGene data will be
-- backfilled onto in migration 4. Fixed, well-known UUID so later
-- migrations/config can reference it deterministically without a lookup.
--
-- planTier='legacy' is a distinct tier meaning "grandfathered, skip
-- Paystack billing checks" — Phase 3 billing-gate logic special-cases it.

INSERT INTO "Organization" (id, name, slug, status, "planTier", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Royal Gene',
  'royalgene',
  'active',
  'legacy',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;
