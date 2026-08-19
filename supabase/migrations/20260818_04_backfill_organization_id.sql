-- Multi-tenancy: Phase 1, migration 4 of 7
-- Backfills every existing row across every table onto the RoyalGene
-- organization created in migration 2. Mechanical, one statement per table.

UPDATE "User"              SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL AND role != 'super_admin';
UPDATE "PortalUser"        SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Shop"              SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Product"           SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "ShopStock"         SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "StockTransaction"  SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "SalesEntry"        SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "ProfitMargin"      SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "LowStockAlert"     SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Alert"             SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Order"             SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Invoice"           SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "Receipt"           SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "PaymentDetails"    SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "CardDetails"       SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "BankTransferDetails" SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;
UPDATE "MpesaDetails"      SET "organizationId" = '00000000-0000-0000-0000-000000000001' WHERE "organizationId" IS NULL;

-- activity_logs / audit_logs / user_roles intentionally left NULL for pre-existing
-- rows — not wired into any read/write path in Phase 1, no reason to force a value.
-- (InvitationCode and snake_case payment_details/card_details don't exist in
-- this database — see migration 3's header note.)
