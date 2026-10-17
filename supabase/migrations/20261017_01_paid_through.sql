-- Read-only workspaces when a paid plan lapses.
-- Run manually in the Supabase SQL Editor BEFORE deploying the code that
-- reads it. Safe to re-run.
--
-- Organization.paidThrough: the end of the period the last successful payment
-- covers. Each payment (first or renewal) moves it forward by one month or
-- year. A few days' grace after it passes with no renewal, the workspace
-- becomes read-only until they pay again. Null = no paid period being tracked
-- (trials, and plans a super admin assigned by hand), which never lapses.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "paidThrough" timestamptz;
