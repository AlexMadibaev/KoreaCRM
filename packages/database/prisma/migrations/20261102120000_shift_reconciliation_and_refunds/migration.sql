ALTER TYPE "CustomerDebtEntryType" ADD VALUE 'RETURN';

ALTER TABLE "CashShift" ADD COLUMN "openingVarianceMinor" DECIMAL(18,0) NOT NULL DEFAULT 0;
ALTER TABLE "CashShift" ADD COLUMN "openingComment" TEXT;
ALTER TABLE "CashShift" ADD COLUMN "closingComment" TEXT;

CREATE TABLE "SaleReturnPayment" (
    "id" UUID NOT NULL,
    "saleReturnId" UUID NOT NULL,
    "paymentId" UUID,
    "paymentMethodId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturnPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaleReturnPayment_saleReturnId_idx" ON "SaleReturnPayment"("saleReturnId");
CREATE INDEX "SaleReturnPayment_paymentId_idx" ON "SaleReturnPayment"("paymentId");

ALTER TABLE "SaleReturnPayment" ADD CONSTRAINT "SaleReturnPayment_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturnPayment" ADD CONSTRAINT "SaleReturnPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturnPayment" ADD CONSTRAINT "SaleReturnPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "SalePaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReceiptlessReturn" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "cashShiftId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptlessReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiptlessReturn_operationId_key" ON "ReceiptlessReturn"("operationId");
CREATE INDEX "ReceiptlessReturn_storeId_createdAt_idx" ON "ReceiptlessReturn"("storeId", "createdAt");
CREATE INDEX "ReceiptlessReturn_cashShiftId_idx" ON "ReceiptlessReturn"("cashShiftId");

ALTER TABLE "ReceiptlessReturn" ADD CONSTRAINT "ReceiptlessReturn_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptlessReturn" ADD CONSTRAINT "ReceiptlessReturn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code") VALUES (gen_random_uuid(), 'sales.return_no_receipt') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'sales.return_no_receipt' AND r."code" IN ('SUPERUSER', 'OWNER', 'DIRECTOR', 'MANAGER')
ON CONFLICT DO NOTHING;
