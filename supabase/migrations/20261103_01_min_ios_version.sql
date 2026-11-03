-- Force update for iOS: builds older than this are blocked until updated. iOS
-- build numbers are unrelated to Android's versionCode, so it needs its own
-- value. 0 = no minimum. Set by super_admin from /platform; served by
-- GET /api/mobile/app/latest-version?platform=ios.
-- Run manually in the Supabase SQL Editor, same as the other platform migrations.

ALTER TABLE "PlatformSettings"
  ADD COLUMN IF NOT EXISTS "minIosVersionCode" integer NOT NULL DEFAULT 0;
