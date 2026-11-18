-- Re-send every shop's stock counts to every phone, once.
--
-- Two bugs could leave a phone showing an old count after a sale or a
-- transfer: stock writes that overwrote each other (a sale's
-- `quantity - sold` putting back a transfer's hold), and a pull cursor that
-- could step past a row that became visible late. Both are fixed in code;
-- this repairs phones that already missed a change. Touching each row bumps
-- "updatedAt" and "version" (sync_touch_row trigger), so every phone pulls
-- the server's count on its next sync. Quantities are not changed.
-- Safe to re-run.

UPDATE "ShopStock" SET "quantity" = "quantity" WHERE "deletedAt" IS NULL;
