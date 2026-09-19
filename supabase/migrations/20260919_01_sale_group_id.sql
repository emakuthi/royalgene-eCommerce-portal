-- Groups every line item recorded together in one Android checkout (one or
-- more products, each possibly with its own size/colour) into a single
-- logical sale, instead of each line item appearing as its own unrelated
-- entry. Null for every row created before this migration — those stay as
-- their own single-item group (the app falls back to a row's own id as its
-- group when saleGroupId is absent).
alter table "SalesEntry" add column if not exists "saleGroupId" uuid;

create index if not exists "SalesEntry_saleGroupId_idx" on "SalesEntry" ("saleGroupId");
