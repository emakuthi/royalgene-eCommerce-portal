-- Custom domains: gates whether a tenant's customDomain (already existed,
-- unique, since the Phase 1 Organization migration) is actually allowed to
-- route traffic. Middleware only ever resolves an org by customDomain when
-- this is 'verified' — this is the real ownership-verification security
-- gate, not just a UI status label.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "customDomainStatus" text
  CHECK ("customDomainStatus" IN ('pending', 'verified', 'misconfigured'));
