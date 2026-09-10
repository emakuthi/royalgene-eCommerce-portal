-- Forgot-password: a short-lived 6-digit code emailed to the account holder.
--
-- Same shape as WorkspaceLookupCode (find-workspace): the code is stored only
-- as a sha256 hash, expires fast, is single-use (consumedAt) and locks out
-- after MAX_ATTEMPTS wrong guesses. Keyed on userId — email is globally
-- unique so one email resolves to exactly one User.

CREATE TABLE IF NOT EXISTS "PasswordResetCode" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "codeHash"   text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "attempts"   integer NOT NULL DEFAULT 0,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_code_user_idx
  ON "PasswordResetCode" ("userId");
CREATE INDEX IF NOT EXISTS password_reset_code_created_idx
  ON "PasswordResetCode" ("createdAt");

-- Stamped whenever the password changes (reset or settings). Not yet
-- enforced at token-verify time (verifyToken is sync, no DB read) — present
-- so a "reject tokens older than this" check can be added later without a
-- migration.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamptz;
