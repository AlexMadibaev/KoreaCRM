-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashOperationType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'CORRECTION');

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "employeeId" UUID NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "attachmentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "openedById" UUID NOT NULL,
    "closedById" UUID,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingCashMinor" DECIMAL(18,0) NOT NULL,
    "expectedCashMinor" DECIMAL(18,0) NOT NULL,
    "actualCashMinor" DECIMAL(18,0),
    "closingCashMinor" DECIMAL(18,0),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashOperation" (
    "id" UUID NOT NULL,
    "cashShiftId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "CashOperationType" NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "cashShiftId" UUID,
    "employeeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE INDEX "Expense_storeId_date_idx" ON "Expense"("storeId", "date");

-- CreateIndex
CREATE INDEX "Expense_categoryId_date_idx" ON "Expense"("categoryId", "date");

-- CreateIndex
CREATE INDEX "CashShift_storeId_status_openedAt_idx" ON "CashShift"("storeId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "CashOperation_storeId_createdAt_idx" ON "CashOperation"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "CashOperation_cashShiftId_createdAt_idx" ON "CashOperation"("cashShiftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashOperation_sourceType_sourceId_key" ON "CashOperation"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_operationId_key" ON "SupplierPayment"("operationId");

-- CreateIndex
CREATE INDEX "SupplierPayment_storeId_createdAt_idx" ON "SupplierPayment"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_createdAt_idx" ON "SupplierPayment"("supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOperation" ADD CONSTRAINT "CashOperation_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOperation" ADD CONSTRAINT "CashOperation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOperation" ADD CONSTRAINT "CashOperation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "CashShift_one_open_per_device" ON "CashShift"("storeId", "deviceId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "Expense_operationId_key" ON "Expense"("operationId");
