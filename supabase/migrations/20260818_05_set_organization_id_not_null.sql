-- Multi-tenancy: Phase 1, migration 5 of 7
-- Locks down organizationId as NOT NULL now that every row has been
-- backfilled (migration 4). User.organizationId stays nullable — it's only
-- ever NULL for role='super_admin' (a platform-level, cross-tenant role) —
-- enforced instead via a CHECK constraint. The three log/RBAC tables that
-- migration 4 deliberately left NULL stay nullable in Phase 1.
--
-- Run this only after confirming migration 4 backfilled every row (spot
-- check with: SELECT count(*) FROM "TableName" WHERE "organizationId" IS NULL).

ALTER TABLE "PortalUser"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Shop"                ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Product"             ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ShopStock"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StockTransaction"    ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SalesEntry"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ProfitMargin"        ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "LowStockAlert"       ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Alert"               ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Order"               ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Invoice"             ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Receipt"             ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PaymentDetails"      ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "CardDetails"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "BankTransferDetails" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MpesaDetails"        ALTER COLUMN "organizationId" SET NOT NULL;

-- (InvitationCode and snake_case payment_details/card_details don't exist in
-- this database — see migration 3's header note.)

-- User: nullable, guarded by CHECK instead of NOT NULL
ALTER TABLE "User" ADD CONSTRAINT user_organization_required_unless_super_admin
  CHECK (role = 'super_admin' OR "organizationId" IS NOT NULL);
