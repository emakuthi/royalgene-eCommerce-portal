-- Workspace discovery (mobile app "find my workspace" flow): migration 1 of 1.
-- POST /api/auth/find-workspace no longer reveals which workspace an email
-- belongs to directly — it sends a one-time code to that email first, and
-- only POST /api/auth/verify-workspace-code (given the correct code) returns
-- the organization(s). codeHash follows the same sha256-of-token pattern as
-- EmailVerificationToken, not stored in plaintext.
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "WorkspaceLookupCode" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  "codeHash"   text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "consumedAt" timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_lookup_code_email_idx ON "WorkspaceLookupCode" (email);
