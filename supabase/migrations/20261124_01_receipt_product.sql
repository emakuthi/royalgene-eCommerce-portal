-- Purchase receipts for stock: link a receipt to the product it restocked.
-- (A restock is an edit of a product's quantity, often made offline on a
-- phone, so a product id is known on every device while the ledger rows'
-- ids are not.) Idempotent.

ALTER TABLE "PurchaseReceipt" ADD COLUMN IF NOT EXISTS "productId" text;

CREATE INDEX IF NOT EXISTS "PurchaseReceipt_product_idx" ON "PurchaseReceipt" ("productId") WHERE "productId" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
