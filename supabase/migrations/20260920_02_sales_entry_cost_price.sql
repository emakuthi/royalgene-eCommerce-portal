-- SalesEntry.costPrice: a snapshot of the product's cost price AT THE TIME
-- OF SALE, used everywhere profit/margin gets computed — Analytics, Reports,
-- Sale Detail, and cost-visibility.server.ts's redaction list (COST_FIELDS)
-- already assumed this column existed.
--
-- It never actually did. Both sale-creation routes (mobile
-- .../shops/[shopId]/sales, and the web portal's /api/portal/sales) only
-- ever computed cost/profit in memory for their own API response, then
-- discarded the number — nothing was persisted. Every synced SalesEntry row
-- was missing cost data by construction, which is why profit has shown as
-- 0 everywhere except transiently, on the exact device that just created a
-- sale, before its next sync pull overwrote the local row with the
-- server's (cost-less) version.
--
-- Idempotent.

ALTER TABLE "SalesEntry" ADD COLUMN IF NOT EXISTS "costPrice" numeric;

-- Backfill: every existing sale used the product's CURRENT cost price as an
-- approximation — the true cost at each sale's own historical moment was
-- never captured, so this is the best available number, not a perfect one.
-- Only fills rows that don't have one yet, so re-running this migration is
-- safe and a future real edit to a row's costPrice is never overwritten.
UPDATE "SalesEntry" se
SET "costPrice" = p."costPrice"
FROM "Product" p
WHERE se."productId" = p."id"
  AND se."costPrice" IS NULL
  AND p."costPrice" IS NOT NULL;
