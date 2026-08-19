-- Entitlement system: migration 5 of 5.
-- Backfills a TenantSubscription row for every existing Organization that
-- doesn't have one yet (all of them, until this runs — TenantSubscription
-- is brand new). Must run after migration 4 (plan seed) since it looks up
-- plan ids by tier.
--
-- Mapping, per the plan: legacy tenants (royalgene) get an unrestricted
-- 'active' subscription with no planId (bypassed entirely by tier check in
-- the entitlement service); tenants already on a paid planTier get linked
-- to the matching plan as 'active'; everything else (free tier, mid-trial,
-- or whose trial already lapsed) is backfilled as 'trialing' on the
-- Professional plan, mirroring what a brand-new signup gets — existing
-- tenants must not lose access.
--
-- Run manually via the Supabase SQL Editor.

DO $$
DECLARE
  professional_id uuid;
BEGIN
  SELECT id INTO professional_id FROM "PlatformPlan" WHERE tier = 'pro' LIMIT 1;

  INSERT INTO "TenantSubscription"
    ("organizationId", "planId", status, "billingInterval", "currentPeriodStart", "trialStart", "trialEnd")
  SELECT
    o.id,
    CASE
      WHEN o."planTier" = 'legacy' THEN NULL
      WHEN o."planTier" IN ('starter', 'business', 'pro', 'enterprise')
        THEN (SELECT id FROM "PlatformPlan" WHERE tier = o."planTier" LIMIT 1)
      ELSE professional_id
    END,
    CASE
      WHEN o."planTier" = 'legacy' THEN 'active'
      WHEN o."planTier" IN ('starter', 'business', 'pro', 'enterprise') AND o."billingStatus" = 'active' THEN 'active'
      WHEN o."trialEndsAt" IS NOT NULL AND o."trialEndsAt" < now() THEN 'expired'
      ELSE 'trialing'
    END,
    NULL,
    now(),
    o."createdAt",
    COALESCE(o."trialEndsAt", o."createdAt" + interval '14 days')
  FROM "Organization" o
  WHERE NOT EXISTS (
    SELECT 1 FROM "TenantSubscription" ts WHERE ts."organizationId" = o.id
  );
END $$;
