CREATE TYPE "NotificationType" AS ENUM ('LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING', 'EXPIRED', 'LARGE_RETURN', 'LARGE_DISCOUNT', 'SYNC_ERROR', 'NEGATIVE_STOCK', 'TRANSFER', 'SYSTEM');

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "storeId" UUID,
    "productId" UUID,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "quantity" INTEGER,
    "minStock" INTEGER,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_userId_sourceKey_key" ON "Notification"("userId", "sourceKey");
CREATE INDEX "Notification_userId_resolvedAt_createdAt_idx" ON "Notification"("userId", "resolvedAt", "createdAt");
CREATE INDEX "Notification_storeId_productId_idx" ON "Notification"("storeId", "productId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
