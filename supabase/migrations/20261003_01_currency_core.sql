-- Phase 1: Currency & Exchange Rate foundation. Run manually in the Supabase
-- SQL Editor (direct DB host is IPv6-only / unreachable from the dev env).
-- Does NOT touch any transaction tables — fully backward compatible; existing
-- KES data is untouched. KES remains the default/base currency.

-- ── Global currency reference list (super_admin-managed) ──────────────────────
CREATE TABLE IF NOT EXISTS "Currency" (
  code        text PRIMARY KEY,                 -- ISO 4217, e.g. 'KES'
  name        text NOT NULL,
  symbol      text NOT NULL,
  decimals    integer NOT NULL DEFAULT 2,
  "isActive"  boolean NOT NULL DEFAULT true,
  "isBase"    boolean NOT NULL DEFAULT false,   -- the global default base (KES)
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "Currency" (code, name, symbol, decimals, "isActive", "isBase") VALUES
  ('KES', 'Kenyan Shilling',    'KSh', 2, true, true),
  ('USD', 'US Dollar',          '$',   2, true, false),
  ('EUR', 'Euro',               '€',   2, true, false),
  ('GBP', 'British Pound',      '£',   2, true, false),
  ('UGX', 'Ugandan Shilling',   'USh', 0, true, false),
  ('TZS', 'Tanzanian Shilling', 'TSh', 2, true, false)
ON CONFLICT (code) DO NOTHING;

-- ── Exchange rates: one table for global (Frankfurter) rates AND per-tenant
--    manual overrides. organizationId NULL = global/auto; set = that tenant's
--    override (never visible to other tenants). History is append-only: a new
--    rateDate row is inserted each day, old rows are never mutated. ───────────
-- The all-zero UUID is the "global" scope sentinel (NOT NULL so a plain unique
-- index works and PostgREST upserts can target it reliably). Tenant overrides
-- use the real organizationId.
CREATE TABLE IF NOT EXISTS "ExchangeRate" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',  -- all-zero = global
  "baseCurrency"       text NOT NULL,
  "targetCurrency"     text NOT NULL,
  rate                 numeric NOT NULL CHECK (rate > 0),
  "rateDate"           date NOT NULL,
  source               text NOT NULL DEFAULT 'FRANKFURTER',  -- 'FRANKFURTER' | 'MANUAL'
  "manuallyOverridden" boolean NOT NULL DEFAULT false,
  "createdBy"          text,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

-- One rate per (scope, pair, day) — a real unique constraint so upserts work.
CREATE UNIQUE INDEX IF NOT EXISTS "ExchangeRate_scope_pair_date_key"
  ON "ExchangeRate" ("organizationId", "baseCurrency", "targetCurrency", "rateDate");
CREATE INDEX IF NOT EXISTS "ExchangeRate_pair_date_idx"
  ON "ExchangeRate" ("baseCurrency", "targetCurrency", "rateDate" DESC);
CREATE INDEX IF NOT EXISTS "ExchangeRate_org_idx" ON "ExchangeRate" ("organizationId");
