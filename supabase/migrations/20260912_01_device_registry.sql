-- Device registry — "signed-in devices" self-service management for the
-- mobile app (device identity, Phase 23 of the local-first program).
--
-- The mobile app generates a stable per-install UUID on first launch and
-- sends it at login/register/signup; the server embeds it as a JWT claim
-- and upserts a row here. A user can list their own devices and revoke one
-- remotely (see /api/mobile/devices routes).
--
-- Revocation only matters if it's actually enforced: verifyToken()
-- (src/lib/auth.server.ts) is deliberately synchronous with no DB read —
-- shared with the web portal, not touched here. verifyMobileShopAccess()
-- (src/lib/mobile-shop-auth.ts), the entry point most shop-scoped mobile
-- routes already go through, is where the revocation check is added
-- instead — already async/DB-touching, mobile-only. A handful of mobile
-- routes call verifyToken() directly and don't go through it (the flat
-- stock-quantity route, /profile, /settings/password, /activity) — those
-- do NOT enforce revocation yet; a known, documented gap, not silently
-- closed by this migration. Same shape as User.passwordChangedAt
-- (20260910_03_password_reset_codes.sql), added ahead of enforcement.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "Device" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "userId"         text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  -- Client-generated stable UUID, one per app install — NOT a primary key
  -- itself so the same physical device can hold a separate row per account
  -- it has ever signed into.
  "deviceId"       text NOT NULL,
  "deviceName"     text,
  platform         text NOT NULL DEFAULT 'android',
  "appVersion"     text,
  "lastActiveAt"   timestamptz NOT NULL DEFAULT now(),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  -- NULL = active. Set = the user revoked this device; verifyMobileShopAccess
  -- rejects any request carrying this device's JWT from this point on.
  "revokedAt"      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS device_user_device_uniq
  ON "Device" ("userId", "deviceId");
CREATE INDEX IF NOT EXISTS device_user_idx
  ON "Device" ("userId");
CREATE INDEX IF NOT EXISTS device_org_idx
  ON "Device" ("organizationId");

-- Deny-all RLS, same as every other table since Phase 0
-- (20260910_04_enable_rls_deny_all.sql) — that migration's
-- ALTER DEFAULT PRIVILEGES already revokes anon/authenticated grants on
-- tables created after it ran, but does NOT auto-enable RLS on them, so
-- this still needs its own ENABLE ROW LEVEL SECURITY.
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Device" FROM anon;
REVOKE ALL ON "Device" FROM authenticated;

-- Verify (run manually after applying):
--   SELECT rowsecurity FROM pg_tables WHERE tablename = 'Device';  -> true
