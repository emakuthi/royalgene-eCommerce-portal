-- Sign in with Apple: links Apple's permanent id for a person to their account.
-- Apple may leave the email out of later sign-ins, and the person can change it,
-- so the email alone can't find them again.
-- Run manually in the Supabase SQL Editor, same as the other migrations.

CREATE TABLE IF NOT EXISTS "AppleIdentity" (
  subject     text PRIMARY KEY,
  "userId"    text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AppleIdentity_user_idx" ON "AppleIdentity" ("userId");

-- Reached only through the service role, like every other table here.
ALTER TABLE "AppleIdentity" ENABLE ROW LEVEL SECURITY;
