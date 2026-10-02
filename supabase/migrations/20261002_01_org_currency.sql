-- Per-tenant base currency (Option A) + an optional manual USD rate used only
-- for a display-only "≈ $" approximate label. All stored amounts remain in the
-- tenant's base currency — this does NOT convert any data, it only changes how
-- amounts are labelled/formatted. Run manually in the Supabase SQL Editor
-- (the direct DB host is IPv6-only / unreachable from the dev env).
--
-- currency : ISO 4217 code the workspace operates in (e.g. 'KES', 'USD').
-- usdRate  : how many units of the base currency equal 1 USD (owner-set).
--            NULL or <= 0 => no approximate-USD label is shown. Ignored when
--            currency is already 'USD'.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'KES';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "usdRate" numeric;
