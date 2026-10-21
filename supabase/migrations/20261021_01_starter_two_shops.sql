-- Starter plan: 2 shops instead of 1. Every new workspace gets a first shop
-- automatically at signup, so with a limit of 1 a Starter workspace (and every
-- Starter free trial) could never add a shop of its own.
UPDATE "PlanEntitlement" e
SET "limitValue" = 2, "updatedAt" = now()
FROM "PlatformPlan" p
WHERE p.id = e."planId" AND p.tier = 'starter' AND e.code = 'BRANCHES' AND e."limitValue" = 1;
