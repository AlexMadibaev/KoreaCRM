-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL,
    "fromStoreId" UUID NOT NULL,
    "toStoreId" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "sentById" UUID,
    "receivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferItem" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceipt" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "receivedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceiptItem" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "transferItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "TransferReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_fromStoreId_status_createdAt_idx" ON "Transfer"("fromStoreId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_toStoreId_status_createdAt_idx" ON "Transfer"("toStoreId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferItem_transferId_productId_key" ON "TransferItem"("transferId", "productId");

-- CreateIndex
CREATE INDEX "TransferReceipt_transferId_createdAt_idx" ON "TransferReceipt"("transferId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferReceipt_transferId_operationId_key" ON "TransferReceipt"("transferId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferReceiptItem_receiptId_transferItemId_key" ON "TransferReceiptItem"("receiptId", "transferItemId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceiptItem" ADD CONSTRAINT "TransferReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "TransferReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceiptItem" ADD CONSTRAINT "TransferReceiptItem_transferItemId_fkey" FOREIGN KEY ("transferItemId") REFERENCES "TransferItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
