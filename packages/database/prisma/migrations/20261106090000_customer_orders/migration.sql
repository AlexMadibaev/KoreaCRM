-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderDeliveryMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "customerId" UUID,
    "createdById" UUID NOT NULL,
    "deliveryMethod" "OrderDeliveryMethod" NOT NULL DEFAULT 'PICKUP',
    "deliveryAddress" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "totalMinor" DECIMAL(18,0) NOT NULL,
    "paidMinor" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "saleId" UUID,
    "completionOperationId" UUID,
    "cancellationOperationId" UUID,
    "cancellationHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceMinor" DECIMAL(18,0) NOT NULL,
    "discountMinor" DECIMAL(18,0) NOT NULL,
    "totalMinor" DECIMAL(18,0) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "cashShiftId" UUID,
    "employeeId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_operationId_key" ON "CustomerOrder"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_saleId_key" ON "CustomerOrder"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_completionOperationId_key" ON "CustomerOrder"("completionOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_cancellationOperationId_key" ON "CustomerOrder"("cancellationOperationId");

-- CreateIndex
CREATE INDEX "CustomerOrder_storeId_status_createdAt_idx" ON "CustomerOrder"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_createdAt_idx" ON "CustomerOrder"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_storeId_number_key" ON "CustomerOrder"("storeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_operationId_key" ON "OrderPayment"("operationId");

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_createdAt_idx" ON "OrderPayment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "SalePaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_amounts_check" CHECK ("totalMinor" > 0 AND "paidMinor" >= 0 AND "paidMinor" <= "totalMinor");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_check" CHECK (quantity > 0 AND "priceMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" = quantity * "priceMinor" - "discountMinor" AND "totalMinor" >= 0);
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_nonzero_check" CHECK ("amountMinor" <> 0);
