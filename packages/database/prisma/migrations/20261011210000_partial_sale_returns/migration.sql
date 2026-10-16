DROP INDEX "SaleReturn_saleId_key";
CREATE INDEX "SaleReturn_saleId_createdAt_idx" ON "SaleReturn"("saleId", "createdAt");

CREATE TABLE "SaleReturnItem" (
    "id" UUID NOT NULL,
    "saleReturnId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "costMinor" DECIMAL(18,0) NOT NULL,
    "profitMinor" DECIMAL(18,0) NOT NULL,
    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleReturnItem_saleReturnId_saleItemId_key" ON "SaleReturnItem"("saleReturnId", "saleItemId");
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SaleReturnItem" ("id", "saleReturnId", "saleItemId", "quantity", "amountMinor", "costMinor", "profitMinor")
SELECT gen_random_uuid(), r."id", i."id", i."quantity", i."totalMinor", i."totalMinor" - i."profitMinor", i."profitMinor"
FROM "SaleReturn" r JOIN "SaleItem" i ON i."saleId" = r."saleId";
