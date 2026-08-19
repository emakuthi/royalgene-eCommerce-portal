-- Entitlement system: migration 4 of 5.
-- Seeds the four named plans with KES/USD pricing, maxShops/maxUsers mirrors
-- (kept for the existing /platform UI), and their full PlanEntitlement rows.
-- Feature/limit codes must match src/lib/entitlements/feature-codes.ts
-- exactly — see that file for which codes are actually enforced vs
-- defined-only (forward-compat placeholders for modules that don't exist
-- in the app yet).
--
-- PlatformPlan.tier is UNIQUE (from the original billing migration). A plan
-- may already exist for a given tier (e.g. the one created manually via
-- /platform while testing checkout earlier) with an arbitrary id — so this
-- upserts by tier, not by a fixed id, and resolves the real row id
-- afterwards for the PlanEntitlement inserts below. Idempotent, safe to
-- re-run. Run manually via the Supabase SQL Editor.

DO $$
DECLARE
  starter_id uuid;
  business_id uuid;
  professional_id uuid;
  enterprise_id uuid;

  -- Cumulative feature sets: each tier includes everything from the tier below it.
  starter_features text[] := ARRAY['INVENTORY','PRODUCT_CATALOG','STOCK_MOVEMENT','STOCK_ADJUSTMENT','BASIC_REPORTS','LOW_STOCK_ALERTS','SALES','MPESA_INTEGRATION'];
  business_features text[] := starter_features || ARRAY['STOCK_TRANSFER','SUPPLIERS','PURCHASE_ORDERS','PURCHASING','BARCODE','AUDIT_TRAIL'];
  professional_features text[] := business_features || ARRAY['STOCK_VALUATION','ADVANCED_REPORTS','ADVANCED_ANALYTICS','BATCH_TRACKING','SERIAL_TRACKING','APPROVAL_WORKFLOW','API_ACCESS','ADVANCED_RBAC','CUSTOM_REPORTS'];
  enterprise_features text[] := professional_features || ARRAY['ACCOUNTING_INTEGRATION','ETIMS_INTEGRATION','CUSTOM_WORKFLOWS','DATA_MIGRATION','DEDICATED_SUPPORT','SLA'];

  -- Every feature code that exists anywhere in the catalog, so disabled ones
  -- get an explicit `enabled=false` row rather than being silently absent.
  all_features text[] := enterprise_features;
  feature text;
BEGIN
  INSERT INTO "PlatformPlan"
    (code, tier, name, description, "monthlyPriceKobo", "annualPriceKobo", "monthlyPriceUSD", "annualPriceUSD", currency, "maxShops", "maxUsers", "isActive", "displayOrder")
  VALUES ('STARTER', 'starter', 'Starter', 'For a single shop getting started with digital stock control.', 150000, 1500000, 1200, 12000, 'KES', 1, 3, true, 1)
  ON CONFLICT (tier) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
    "monthlyPriceKobo" = EXCLUDED."monthlyPriceKobo", "annualPriceKobo" = EXCLUDED."annualPriceKobo",
    "monthlyPriceUSD" = EXCLUDED."monthlyPriceUSD", "annualPriceUSD" = EXCLUDED."annualPriceUSD",
    "maxShops" = EXCLUDED."maxShops", "maxUsers" = EXCLUDED."maxUsers", "displayOrder" = EXCLUDED."displayOrder",
    "updatedAt" = now()
  RETURNING id INTO starter_id;

  INSERT INTO "PlatformPlan"
    (code, tier, name, description, "monthlyPriceKobo", "annualPriceKobo", "monthlyPriceUSD", "annualPriceUSD", currency, "maxShops", "maxUsers", "isActive", "displayOrder")
  VALUES ('BUSINESS', 'business', 'Business', 'For growing operations running multiple branches.', 350000, 3500000, 2800, 28000, 'KES', 3, 8, true, 2)
  ON CONFLICT (tier) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
    "monthlyPriceKobo" = EXCLUDED."monthlyPriceKobo", "annualPriceKobo" = EXCLUDED."annualPriceKobo",
    "monthlyPriceUSD" = EXCLUDED."monthlyPriceUSD", "annualPriceUSD" = EXCLUDED."annualPriceUSD",
    "maxShops" = EXCLUDED."maxShops", "maxUsers" = EXCLUDED."maxUsers", "displayOrder" = EXCLUDED."displayOrder",
    "updatedAt" = now()
  RETURNING id INTO business_id;

  INSERT INTO "PlatformPlan"
    (code, tier, name, description, "monthlyPriceKobo", "annualPriceKobo", "monthlyPriceUSD", "annualPriceUSD", currency, "maxShops", "maxUsers", "isActive", "displayOrder")
  VALUES ('PROFESSIONAL', 'pro', 'Professional', 'Full analytics and scale for established retailers.', 750000, 7500000, 6000, 60000, 'KES', 10, 20, true, 3)
  ON CONFLICT (tier) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
    "monthlyPriceKobo" = EXCLUDED."monthlyPriceKobo", "annualPriceKobo" = EXCLUDED."annualPriceKobo",
    "monthlyPriceUSD" = EXCLUDED."monthlyPriceUSD", "annualPriceUSD" = EXCLUDED."annualPriceUSD",
    "maxShops" = EXCLUDED."maxShops", "maxUsers" = EXCLUDED."maxUsers", "displayOrder" = EXCLUDED."displayOrder",
    "updatedAt" = now()
  RETURNING id INTO professional_id;

  INSERT INTO "PlatformPlan"
    (code, tier, name, description, "monthlyPriceKobo", "annualPriceKobo", "monthlyPriceUSD", "annualPriceUSD", currency, "maxShops", "maxUsers", "isActive", "displayOrder")
  VALUES ('ENTERPRISE', 'enterprise', 'Enterprise', 'Custom limits and dedicated support for large operations.', 2000000, 20000000, NULL, NULL, 'KES', NULL, NULL, true, 4)
  ON CONFLICT (tier) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
    "monthlyPriceKobo" = EXCLUDED."monthlyPriceKobo", "annualPriceKobo" = EXCLUDED."annualPriceKobo",
    "monthlyPriceUSD" = EXCLUDED."monthlyPriceUSD", "annualPriceUSD" = EXCLUDED."annualPriceUSD",
    "maxShops" = EXCLUDED."maxShops", "maxUsers" = EXCLUDED."maxUsers", "displayOrder" = EXCLUDED."displayOrder",
    "updatedAt" = now()
  RETURNING id INTO enterprise_id;

  FOREACH feature IN ARRAY all_features LOOP
    INSERT INTO "PlanEntitlement" ("planId", code, "limitValue", enabled)
    VALUES (starter_id, feature, NULL, feature = ANY(starter_features))
    ON CONFLICT ("planId", code) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now();

    INSERT INTO "PlanEntitlement" ("planId", code, "limitValue", enabled)
    VALUES (business_id, feature, NULL, feature = ANY(business_features))
    ON CONFLICT ("planId", code) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now();

    INSERT INTO "PlanEntitlement" ("planId", code, "limitValue", enabled)
    VALUES (professional_id, feature, NULL, feature = ANY(professional_features))
    ON CONFLICT ("planId", code) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now();

    INSERT INTO "PlanEntitlement" ("planId", code, "limitValue", enabled)
    VALUES (enterprise_id, feature, NULL, feature = ANY(enterprise_features))
    ON CONFLICT ("planId", code) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now();
  END LOOP;

  -- Quantitative limits. NULL limitValue = unlimited. WAREHOUSES/STORAGE_GB
  -- are seeded for completeness but not enforced (see feature-codes.ts).
  INSERT INTO "PlanEntitlement" ("planId", code, "limitValue", enabled) VALUES
    (starter_id, 'USERS', 3, true), (starter_id, 'BRANCHES', 1, true), (starter_id, 'WAREHOUSES', NULL, true),
    (starter_id, 'PRODUCTS', 1000, true), (starter_id, 'MONTHLY_TRANSACTIONS', 1000, true), (starter_id, 'STORAGE_GB', 2, true),

    (business_id, 'USERS', 8, true), (business_id, 'BRANCHES', 3, true), (business_id, 'WAREHOUSES', NULL, true),
    (business_id, 'PRODUCTS', 10000, true), (business_id, 'MONTHLY_TRANSACTIONS', 10000, true), (business_id, 'STORAGE_GB', 10, true),

    (professional_id, 'USERS', 20, true), (professional_id, 'BRANCHES', 10, true), (professional_id, 'WAREHOUSES', NULL, true),
    (professional_id, 'PRODUCTS', 50000, true), (professional_id, 'MONTHLY_TRANSACTIONS', 50000, true), (professional_id, 'STORAGE_GB', 50, true),

    (enterprise_id, 'USERS', NULL, true), (enterprise_id, 'BRANCHES', NULL, true), (enterprise_id, 'WAREHOUSES', NULL, true),
    (enterprise_id, 'PRODUCTS', NULL, true), (enterprise_id, 'MONTHLY_TRANSACTIONS', NULL, true), (enterprise_id, 'STORAGE_GB', NULL, true)
  ON CONFLICT ("planId", code) DO UPDATE SET "limitValue" = EXCLUDED."limitValue", "updatedAt" = now();
END $$;
