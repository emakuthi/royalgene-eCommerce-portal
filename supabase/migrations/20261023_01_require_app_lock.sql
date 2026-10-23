-- Owner policy: staff must set an app lock (PIN/pattern) on the RoyalTrack
-- Android app. Read via the business settings (GET /api/mobile/settings/business);
-- the app shows a non-skippable "set a lock" screen while it's on.
-- Until this runs, the setting reads as off and saving it returns a clear error.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "requireAppLock" boolean NOT NULL DEFAULT false;
