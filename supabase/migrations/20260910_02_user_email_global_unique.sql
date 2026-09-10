-- One email = one account, across every workspace.
--
-- Reverts 20260818_06 (email unique *per organization*): self-serve signup,
-- the mobile app's "log in with just your email + password" flow, and
-- customer support all get simpler when an email maps to exactly one User.
--
-- PRE-FLIGHT — this migration fails if any email is currently shared by two
-- User rows. Find and resolve them first:
--
--   SELECT lower(email) AS email, count(*), array_agg("organizationId") AS orgs
--   FROM "User" GROUP BY lower(email) HAVING count(*) > 1;
--
-- Resolve each (change one side's email, or delete the unwanted account and
-- its PortalUser / re-parent its rows) before running this.

DROP INDEX IF EXISTS user_email_org_unique;
DROP INDEX IF EXISTS user_email_platform_unique;

-- Case-insensitive, global. Covers platform super_admins (organizationId
-- NULL) and tenant users alike.
CREATE UNIQUE INDEX IF NOT EXISTS user_email_global_unique
  ON "User" (lower(email));
