-- Per-tenant branding: favicon.
--
-- Organization already has logoUrl + tagline + themeSettings columns (added
-- with the table / early multi-tenant work) that were never wired to
-- anything. This adds the one missing piece — faviconUrl — so the branding
-- tab can persist logo, favicon, name and tagline per tenant on the server
-- instead of per-browser in localStorage.
--
-- Values are small resized data URIs (logo ~128px, favicon ~64px), stored
-- inline rather than in Storage so they don't count against the tenant's
-- STORAGE_GB plan limit and need no upload/cleanup plumbing.
--
-- Idempotent.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "faviconUrl" text;
