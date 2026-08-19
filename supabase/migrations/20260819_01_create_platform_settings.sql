-- Platform admin console: singleton settings row, currently just the
-- self-serve signup kill-switch. Run manually via the Supabase SQL Editor,
-- same as the Phase 1 migrations (direct psql connection is IPv6-only and
-- unreachable from this environment/most local networks).

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
  id                  text PRIMARY KEY DEFAULT 'singleton',
  "selfSignupEnabled" boolean NOT NULL DEFAULT true,
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedBy"         text
);

INSERT INTO "PlatformSettings" (id, "selfSignupEnabled")
VALUES ('singleton', true)
ON CONFLICT (id) DO NOTHING;
