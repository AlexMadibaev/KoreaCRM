-- CreateEnum
CREATE TYPE "PosDeviceStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "PosDevice" (
    "deviceId" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "appVersion" TEXT NOT NULL,
    "status" "PosDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosDevice_pkey" PRIMARY KEY ("deviceId")
);

-- CreateIndex
CREATE INDEX "PosDevice_storeId_status_idx" ON "PosDevice"("storeId", "status");

-- AddForeignKey
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
