-- Multi-tenancy: Phase 1, migration 7 of 7
-- Table backing the self-serve signup email verification flow
-- (src/app/api/auth/signup, src/app/api/auth/verify-email).

CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "User"."id" is text (app-generated uuid strings), not native uuid — match it.
  "userId"         text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "tokenHash"      text NOT NULL,
  "expiresAt"      timestamptz NOT NULL,
  "consumedAt"     timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_token_hash_idx
  ON "EmailVerificationToken" ("tokenHash");

CREATE INDEX IF NOT EXISTS email_verification_user_id_idx
  ON "EmailVerificationToken" ("userId");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz;
