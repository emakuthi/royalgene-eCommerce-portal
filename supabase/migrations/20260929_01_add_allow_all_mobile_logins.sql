-- Platform kill-switch to BYPASS the per-user mobile-access gate in
-- buildMobileAuthResponse. When true, any user with a valid, active workspace
-- can log into the mobile app even if they have no PortalUser / mobileAccess is
-- off (bypassed non-admins are handed their org's shops so the session is
-- usable). Suspended/closed-workspace and no-workspace guards still apply.
-- Intended for a testing/beta phase — leave FALSE in production. Run manually
-- via the Supabase SQL Editor, same as the other platform migrations.
--
-- Self-contained: creates PlatformSettings if it was never created (the
-- 20260819_01 create migration turns out not to have been run in prod — the
-- self-signup toggle silently fails-open to enabled when the table is absent),
-- and also handles the case where the table exists without the new column.

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
  id                     text PRIMARY KEY DEFAULT 'singleton',
  "selfSignupEnabled"    boolean NOT NULL DEFAULT true,
  "allowAllMobileLogins" boolean NOT NULL DEFAULT false,
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedBy"            text
);

ALTER TABLE "PlatformSettings"
  ADD COLUMN IF NOT EXISTS "allowAllMobileLogins" boolean NOT NULL DEFAULT false;

INSERT INTO "PlatformSettings" (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
