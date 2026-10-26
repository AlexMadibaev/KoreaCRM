CREATE TABLE "LoyaltySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoyaltySettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "rewardBalanceMinor" DECIMAL(18,0) NOT NULL DEFAULT 0;
CREATE TABLE "EmployeeRewardTransaction" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "deltaMinor" DECIMAL(18,0) NOT NULL,
    "balanceAfterMinor" DECIMAL(18,0) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeRewardTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeRewardTransaction_operationId_key" ON "EmployeeRewardTransaction"("operationId");
CREATE INDEX "EmployeeRewardTransaction_employeeId_createdAt_idx" ON "EmployeeRewardTransaction"("employeeId", "createdAt");
CREATE INDEX "EmployeeRewardTransaction_saleId_idx" ON "EmployeeRewardTransaction"("saleId");
ALTER TABLE "EmployeeRewardTransaction" ADD CONSTRAINT "EmployeeRewardTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code") VALUES (gen_random_uuid(), 'customers.discount.edit') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'customers.discount.edit' AND r."code" IN ('OWNER', 'DIRECTOR', 'MANAGER', 'ADMIN', 'CASHIER', 'SELLER')
ON CONFLICT DO NOTHING;
