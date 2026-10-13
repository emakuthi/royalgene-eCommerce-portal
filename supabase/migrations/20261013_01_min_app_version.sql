-- Force update: app builds older than this versionCode are blocked with an
-- "Update required" screen until the user updates (Play Store, or the
-- self-hosted APK for direct installs). 0 = no minimum. Set by super_admin
-- from /platform; served to the app by GET /api/mobile/app/latest-version.
-- Run manually in the Supabase SQL Editor, same as the other platform migrations.

ALTER TABLE "PlatformSettings"
  ADD COLUMN IF NOT EXISTS "minAppVersionCode" integer NOT NULL DEFAULT 0;
