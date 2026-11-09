BEGIN;
ALTER TABLE "ProductBarcode" ADD COLUMN "deletedAt" TIMESTAMP(3);
UPDATE "ProductBarcode" AS barcode
SET "deletedAt" = product."deletedAt"
FROM "Product" AS product
WHERE barcode."productId" = product.id AND product."deletedAt" IS NOT NULL;
DROP INDEX "Product_sku_key";
DROP INDEX "ProductBarcode_value_key";
CREATE UNIQUE INDEX "Product_active_sku_key" ON "Product" (sku) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "ProductBarcode_active_value_key" ON "ProductBarcode" (value) WHERE "deletedAt" IS NULL;
COMMIT;
