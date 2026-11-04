-- The build that is live on Google Play, recorded by hand in /platform because
-- the portal can't read Play Console. Force update warns before requiring a
-- build newer than this, since Play installs would have nothing to update to.
-- 0 = not recorded.
-- Run manually in the Supabase SQL Editor, same as the other platform migrations.

ALTER TABLE "PlatformSettings"
  ADD COLUMN IF NOT EXISTS "playLiveVersionCode" integer NOT NULL DEFAULT 0;
