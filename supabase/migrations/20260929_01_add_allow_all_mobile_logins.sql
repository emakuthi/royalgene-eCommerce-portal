-- Platform kill-switch to BYPASS the per-user mobile-access gate in
-- buildMobileAuthResponse. When true, any user with a valid, active workspace
-- can log into the mobile app even if they have no PortalUser / mobileAccess is
-- off (bypassed non-admins are handed their org's shops so the session is
-- usable). Suspended/closed-workspace and no-workspace guards still apply.
-- Intended for a testing/beta phase — leave FALSE in production. Run manually
-- via the Supabase SQL Editor, same as the other platform migrations.

ALTER TABLE "PlatformSettings"
  ADD COLUMN IF NOT EXISTS "allowAllMobileLogins" boolean NOT NULL DEFAULT false;
