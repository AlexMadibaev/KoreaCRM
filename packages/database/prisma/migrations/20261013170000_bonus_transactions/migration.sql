CREATE TYPE "BonusTransactionType" AS ENUM ('EARN', 'SPEND', 'CORRECTION', 'EXPIRE');

CREATE TABLE "BonusTransaction" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" "BonusTransactionType" NOT NULL,
    "deltaMinor" DECIMAL(18,0) NOT NULL,
    "balanceAfterMinor" DECIMAL(18,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BonusTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BonusTransaction_operationId_key" ON "BonusTransaction"("operationId");
CREATE INDEX "BonusTransaction_customerId_createdAt_idx" ON "BonusTransaction"("customerId", "createdAt");

ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
