-- QuickBooks integration: migration 3 of 4.
-- Separate from TenantIntegrationConfig (M-Pesa) deliberately — OAuth tokens
-- have a different lifecycle (refresh, expiry, revocation) than static
-- API-key-style secrets. Tokens are encrypted the same way as M-Pesa's
-- credentials (src/lib/crypto/secret-box.server.ts).
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "TenantOAuthConnection" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"         uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  provider                 text NOT NULL, -- 'quickbooks' today, extensible
  "externalAccountId"      text, -- QuickBooks realmId (company id)
  "encryptedAccessToken"   text,
  "encryptedRefreshToken"  text,
  "tokenExpiresAt"         timestamptz,
  "connectedBy"            text, -- User.id, no FK (legacy text PK)
  "isActive"               boolean NOT NULL DEFAULT true,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_oauth_connection_unique UNIQUE ("organizationId", provider)
);

CREATE INDEX IF NOT EXISTS tenant_oauth_connection_org_idx ON "TenantOAuthConnection" ("organizationId");
