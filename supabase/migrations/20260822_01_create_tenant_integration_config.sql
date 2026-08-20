-- Per-tenant integration configuration (M-Pesa first, extensible to future
-- integrations — accounting, eTIMS — via the integrationType column rather
-- than a new table each time). Secrets (consumerKey/consumerSecret/passkey)
-- are stored encrypted (AES-256-GCM, app-layer) in "encryptedSecrets" — never
-- as plaintext. businessShortCode/environment/callbackUrl stay plaintext
-- since they're not secret and are needed for display.
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "TenantIntegrationConfig" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"      uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "integrationType"     text NOT NULL,
  "businessShortCode"   text,
  environment           text CHECK (environment IN ('sandbox', 'production')),
  "callbackUrl"         text,
  "encryptedSecrets"    text,
  "isActive"            boolean NOT NULL DEFAULT true,
  "configuredBy"        text,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_integration_config_unique UNIQUE ("organizationId", "integrationType")
);

CREATE INDEX IF NOT EXISTS tenant_integration_config_org_idx ON "TenantIntegrationConfig" ("organizationId");
