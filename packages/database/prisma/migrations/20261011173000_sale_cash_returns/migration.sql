CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "cashShiftId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "costMinor" DECIMAL(18,0) NOT NULL,
    "profitMinor" DECIMAL(18,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleReturn_operationId_key" ON "SaleReturn"("operationId");
CREATE UNIQUE INDEX "SaleReturn_saleId_key" ON "SaleReturn"("saleId");
CREATE INDEX "SaleReturn_storeId_createdAt_idx" ON "SaleReturn"("storeId", "createdAt");
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
