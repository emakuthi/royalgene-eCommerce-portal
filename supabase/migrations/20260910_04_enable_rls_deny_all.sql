-- Phase 0 — security lockdown.
--
-- The app authenticates with a CUSTOM HS256 JWT (src/lib/auth.server.ts), not
-- Supabase Auth, so PostgREST can never see an app user as "authenticated" —
-- every request with the public publishable/anon key is `role = anon`. A
-- per-tenant RLS policy (USING organizationId = auth.jwt()->>'org') therefore
-- has nothing to filter on.
--
-- All legitimate database access already goes through the Next.js API with the
-- service_role key (which bypasses RLS). The audit found the public anon key
-- could still read/delete Product, Organization, TenantSubscription,
-- PasswordResetCode and EmailVerificationToken directly via /rest/v1/*.
--
-- Fix: enable RLS on every table in `public` and add NO policies → deny for
-- every role except service_role. Also revoke table-level grants from anon /
-- authenticated, present and future. Net effect: the anon key can no longer
-- touch application data at all. The API layer keeps enforcing tenant
-- isolation via organizationId scoping, now with a hard DB backstop.
--
-- Idempotent.

-- 1. Enable RLS on every base table in public (skips views/matviews).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 2. Revoke all table privileges from the public API roles on existing tables.
--    (RLS already denies row access, but this removes the grant entirely so a
--     future policy can't accidentally re-open a table without a deliberate GRANT.)
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.tablename);
  END LOOP;
END $$;

-- 3. Any table created from here on is locked to the API roles by default.
--    (service_role keeps full access via its own default-privilege line and
--     the bypassrls attribute.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- Verify (run manually after applying):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity;
--   -> expect 0 rows
--   With only the publishable/anon key:
--     curl .../rest/v1/Product   -> [] or 401
--     curl .../rest/v1/Organization -> [] or 401
