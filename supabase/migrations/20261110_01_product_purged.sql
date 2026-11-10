-- "Delete permanently" in Deleted Products.
--
-- A product with sales, shop orders or stock transfers can't lose its row: sales
-- and orders point at it (and block the delete), and transfers would be erased
-- with it. Those are marked purged instead: gone from Deleted Products for good,
-- not restorable, while their history keeps its name. A product with none of
-- these is deleted outright by the code.
--
-- Safe to run before the code that uses it deploys: nothing reads the column yet.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "purgedAt" timestamptz;
