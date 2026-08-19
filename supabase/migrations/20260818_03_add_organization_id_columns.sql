-- Multi-tenancy: Phase 1, migration 3 of 7
-- Adds organizationId/organization_id to every tenant-scoped table found by
-- grepping every `.from('TableName')` call site in src/, cross-checked
-- against the live schema (information_schema.tables) on 2026-08-18. Columns
-- are added NULLable here; migration 4 backfills them, migration 5 sets NOT
-- NULL.
--
-- Two corrections vs. the original grep-only table list, found by actually
-- querying the live DB:
--   - "InvitationCode" does not exist live (the mobile registration route
--     code that queries it is currently non-functional against this
--     database, independent of this migration) — excluded.
--   - Only the PascalCase "PaymentDetails"/"CardDetails" exist live; the
--     snake_case payment_details/card_details do not exist (the query code
--     hitting them in supabase-db.ts is dead against this database) —
--     excluded.
--
-- Note: two independently-named alert tables are both live
-- (`Alert` used by portal/mobile alert routes, `LowStockAlert` used once by
-- portal/sales) — both get the column.
--
-- permissions/role_permissions are left global (platform-defined catalog),
-- per the plan. The live DB also has legacy lowercase "shops"/"portal_users"
-- tables alongside "Shop"/"PortalUser" — those are orphaned/unused by the
-- app (confirmed via grep, zero query call sites) and are left untouched.

-- camelCase family (PascalCase tables)
ALTER TABLE "User"              ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "PortalUser"        ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Shop"              ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Product"           ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "ShopStock"         ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "StockTransaction"  ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "SalesEntry"        ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "ProfitMargin"      ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "LowStockAlert"     ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Alert"             ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Order"             ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Invoice"           ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "Receipt"           ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "PaymentDetails"    ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "CardDetails"       ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "BankTransferDetails" ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE "MpesaDetails"      ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS user_organization_id_idx              ON "User" ("organizationId");
CREATE INDEX IF NOT EXISTS portal_user_organization_id_idx       ON "PortalUser" ("organizationId");
CREATE INDEX IF NOT EXISTS shop_organization_id_idx               ON "Shop" ("organizationId");
CREATE INDEX IF NOT EXISTS product_organization_id_idx            ON "Product" ("organizationId");
CREATE INDEX IF NOT EXISTS shop_stock_organization_id_idx         ON "ShopStock" ("organizationId");
CREATE INDEX IF NOT EXISTS stock_transaction_organization_id_idx  ON "StockTransaction" ("organizationId");
CREATE INDEX IF NOT EXISTS sales_entry_organization_id_idx        ON "SalesEntry" ("organizationId");
CREATE INDEX IF NOT EXISTS profit_margin_organization_id_idx      ON "ProfitMargin" ("organizationId");
CREATE INDEX IF NOT EXISTS low_stock_alert_organization_id_idx    ON "LowStockAlert" ("organizationId");
CREATE INDEX IF NOT EXISTS alert_organization_id_idx              ON "Alert" ("organizationId");
CREATE INDEX IF NOT EXISTS order_organization_id_idx              ON "Order" ("organizationId");
CREATE INDEX IF NOT EXISTS invoice_organization_id_idx            ON "Invoice" ("organizationId");
CREATE INDEX IF NOT EXISTS receipt_organization_id_idx            ON "Receipt" ("organizationId");
CREATE INDEX IF NOT EXISTS payment_details_organization_id_idx    ON "PaymentDetails" ("organizationId");
CREATE INDEX IF NOT EXISTS card_details_organization_id_idx       ON "CardDetails" ("organizationId");
CREATE INDEX IF NOT EXISTS bank_transfer_details_organization_id_idx ON "BankTransferDetails" ("organizationId");
CREATE INDEX IF NOT EXISTS mpesa_details_organization_id_idx      ON "MpesaDetails" ("organizationId");

-- snake_case family (only tables confirmed to exist live)
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE audit_logs    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;
ALTER TABLE user_roles    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES "Organization"(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS activity_logs_organization_id_idx ON activity_logs (organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_organization_id_idx    ON audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS user_roles_organization_id_idx    ON user_roles (organization_id);
